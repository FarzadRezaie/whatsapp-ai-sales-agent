import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { getT } from '@/lib/i18n/translate'
import { formatCatalogForPrompt, formatPrice, loadActiveProducts } from '@/lib/products/catalog'
import { matchProductPhoto } from '@/lib/products/match'
import { photoMatchPrompt } from '@/lib/products/photo-prompt'
import { VISION_MIME_TYPES } from '@/lib/ai/vision'
import { PHOTO_MARKER } from '@/lib/ai/context'
import { holdingMessageFor } from '@/lib/ai/holding-message'

const t = getT('Api')

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20
// A test photo is sent as base64 in the JSON body; WhatsApp caps
// photos at 5 MB, and base64 adds a third.
const MAX_TEST_PHOTO_BASE64 = 7_000_000

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses — knowledge-base retrieval +
 * `auto_reply` system prompt + the configured provider — so what you see
 * here is what a real customer would get. Reads the config even when the
 * master switch is off (requireActive:false) so you can try it before
 * going live. Stateless: the client sends the running transcript each turn.
 *
 * Optional `image: { mimeType, base64 }` tests PHOTO matching: the photo
 * is matched against the product catalog exactly like a WhatsApp photo,
 * and the response says which product (with its photo) the customer
 * would receive — or that the chat would go to a human.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: t('ai.messagesRequired') }, { status: 400 })
    }

    const rawImage = body?.image
    let image: { mimeType: string; base64: string } | null = null
    if (rawImage !== undefined && rawImage !== null) {
      const mimeType = typeof rawImage?.mimeType === 'string' ? rawImage.mimeType.toLowerCase() : ''
      const base64 = typeof rawImage?.base64 === 'string' ? rawImage.base64 : ''
      if (
        !VISION_MIME_TYPES.has(mimeType) ||
        !base64 ||
        base64.length > MAX_TEST_PHOTO_BASE64 ||
        !/^[A-Za-z0-9+/=]+$/.test(base64)
      ) {
        return NextResponse.json({ error: t('products.testPhotoInvalid') }, { status: 400 })
      }
      image = { mimeType, base64 }
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0 && image) {
      messages.push({ role: 'user', content: PHOTO_MARKER })
    }

    if (messages.length === 0) {
      return NextResponse.json(
        { error: t('ai.sendMessageToTest') },
        { status: 400 },
      )
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/playground] loadAiConfig error:', err)
      throw new AiError(t('ai.storedKeyUndecryptable'), {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: t('ai.noAgentConfigured'),
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const products = await loadActiveProducts(supabase, accountId)
    const catalog = formatCatalogForPrompt(products)

    let photoContext: string | null = null
    let matchedProduct: (typeof products)[number] | null = null
    if (image) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      const caption =
        lastUser && lastUser.content.startsWith(PHOTO_MARKER)
          ? lastUser.content.slice(PHOTO_MARKER.length).trim() || null
          : null
      const match = await matchProductPhoto({ config, products, image, caption })
      if (match.status !== 'matched' || !match.product) {
        // Same outcome as WhatsApp: no guess, the chat goes to a human
        // and the customer gets the holding message.
        return NextResponse.json({
          reply: holdingMessageFor(config.handoffMessage, caption ?? ''),
          handoff: true,
          photo: {
            status: match.status,
            description: match.description,
          },
        })
      }
      matchedProduct = match.product
      photoContext = photoMatchPrompt(match.product, !!match.product.image_url)
    }

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages),
    )
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      catalog,
      photoContext,
    })

    const { text, handoff } = await generateReply({ config, systemPrompt, messages })
    // Show exactly what the customer would get: on a handoff that is the
    // holding message, not the (empty) model text.
    const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    return NextResponse.json({
      reply: handoff || !text ? holdingMessageFor(config.handoffMessage, lastUserText) : text,
      handoff: handoff || !text,
      photo: matchedProduct && !handoff && text
        ? {
            status: 'matched',
            product: {
              id: matchedProduct.id,
              name: matchedProduct.name,
              price: formatPrice(matchedProduct.price, matchedProduct.currency),
              image_url: matchedProduct.image_url,
            },
          }
        : undefined,
    })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
