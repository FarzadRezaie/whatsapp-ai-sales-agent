import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import {
  engineSendMedia,
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { holdingMessageFor } from './holding-message'
import { isOverMonthlyCap, loadMonthlyUsage } from './monthly-usage'
import type { AiConfig, AiUsage, ChatMessage } from './types'
import { formatCatalogForPrompt, loadActiveProducts } from '@/lib/products/catalog'
import { matchProductPhoto } from '@/lib/products/match'
import { loadInboundPhoto } from '@/lib/products/inbound-photo'
import { photoMatchPrompt } from '@/lib/products/photo-prompt'
import type { ProductWithImage } from '@/lib/products/types'

/** WhatsApp caps an image caption at 1024 characters. */
const MAX_CAPTION_LENGTH = 1024

const UNSUPPORTED_LABEL = {
  audio: 'voice message',
  video: 'video',
  document: 'document',
} as const

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
  /** Set when the inbound is a PHOTO. The bot matches it against the
   *  product catalog and answers with the matched product's own photo
   *  + price; an unmatched photo is handed to a human. */
  inboundImage?: {
    /** Meta media id of the photo. */
    mediaId: string
    /** Caption the customer typed with the photo, if any. */
    caption: string | null
  }
  /** Set when the inbound is media the bot can't read (voice note,
   *  video, document). The bot hands the chat to a human with a
   *  holding message instead of ignoring it. */
  inboundUnsupported?: 'audio' | 'video' | 'document'
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - there's nothing to reply to
 *
 * Everything else ends with the customer getting a message — never
 * "typing…" followed by silence:
 *   - a normal reply (text, or the matched product's photo + caption)
 *   - a HANDOFF: the bot pauses on this thread, routes it to a human,
 *     and sends a short holding message ("a colleague will reply
 *     shortly"). Triggered by the model asking for it, an unmatched
 *     photo, the per-conversation reply cap, or a provider failure
 *     (rate limit, timeout…).
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
    inboundImage,
    inboundUnsupported,
  } = args

  // Set once every gate has passed. From then on a failure must not
  // leave the customer with "typing…" and nothing — see the catch.
  let committed = false
  let configForHandoff: AiConfig | null = null
  let messagesForHandoff: ChatMessage[] = []
  let replyCountForHandoff = 0

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0 && !inboundUnsupported) return

    configForHandoff = config
    messagesForHandoff = messages
    replyCountForHandoff = conv.ai_reply_count ?? 0

    // Reply cap reached: hand the thread to a human with a holding
    // message instead of going quiet. (Cheap early check; the
    // authoritative cap check is the atomic claim below, which can
    // still lose a race to a concurrent inbound — that inbound replies.)
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) {
      await handOff({
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        config,
        messages,
        replyCount: replyCountForHandoff,
        reason: 'reply limit for this chat reached',
      })
      return
    }

    // Monthly plan allowance reached (bot + team messages this month):
    // the bot steps back and the team answers until next month.
    if (config.monthlyReplyCap) {
      const usage = await loadMonthlyUsage(db, accountId)
      if (isOverMonthlyCap(config.monthlyReplyCap, usage)) {
        await handOff({
          accountId,
          conversationId,
          contactId,
          configOwnerUserId,
          config,
          messages,
          replyCount: replyCountForHandoff,
          reason: 'monthly message limit reached',
        })
        return
      }
    }

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Every gate has passed — we're committed to attempting a reply, so
    // show the customer "typing…" (and mark their message read) while the
    // retrieval + LLM round trips run. Meta clears the indicator after
    // 25 s or when our reply lands, whichever is first, so there's
    // nothing to undo on the handoff / no-text path. Strictly
    // best-effort: a failed indicator must never cost us the reply.
    committed = true

    // Voice note / video / document: the bot can't read it, so a human
    // takes over — but the customer still hears back right away.
    if (inboundUnsupported) {
      await handOff({
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        config,
        messages,
        replyCount: replyCountForHandoff,
        reason: `customer sent a ${UNSUPPORTED_LABEL[inboundUnsupported]}`,
      })
      return
    }

    if (inboundMessageId) {
      await showTypingIndicator(db, accountId, inboundMessageId)
    }

    // The product catalog grounds every reply (prices, sizes, stock)
    // and is what a customer photo is matched against.
    const products = await loadActiveProducts(db, accountId)
    const catalog = formatCatalogForPrompt(products)

    // Customer sent a PHOTO: find the product. Unmatched → a human.
    let photoContext: string | null = null
    let productToSend: ProductWithImage | null = null
    if (inboundImage) {
      const match = await matchInboundPhoto({
        db,
        accountId,
        conversationId,
        config,
        products,
        mediaId: inboundImage.mediaId,
        caption: inboundImage.caption,
      })
      if (!match.product) {
        await handOff({
          accountId,
          conversationId,
          contactId,
          configOwnerUserId,
          config,
          messages,
          replyCount: replyCountForHandoff,
          reason: match.reason,
        })
        return
      }
      productToSend = match.product
      photoContext = photoMatchPrompt(match.product, !!match.product.image_url)
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
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

    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      await handOff({
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        config,
        messages,
        replyCount: replyCountForHandoff,
        reason: null,
      })
      return
    }

    if (
      inboundMessageId &&
      (await hasNewerInbound(db, conversationId, inboundMessageId))
    ) {
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return

    if (productToSend?.image_url) {
      // One message: the shop's own product photo, the reply as caption.
      await engineSendMedia({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        kind: 'image',
        link: productToSend.image_url,
        caption: truncateCaption(text),
        aiGenerated: true,
      })
    } else {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text,
        aiGenerated: true,
      })
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
    // A failure after we committed (provider rate limit / timeout / bad
    // answer, or a failed send) would otherwise leave the customer with
    // "typing…" and nothing. Hand the thread to a human with a holding
    // message instead. Best-effort — handOff never throws.
    if (committed && configForHandoff) {
      await handOff({
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        config: configForHandoff,
        messages: messagesForHandoff,
        replyCount: replyCountForHandoff,
        reason: 'AI provider error',
      })
    }
  }
}

function truncateCaption(text: string): string {
  if (text.length <= MAX_CAPTION_LENGTH) return text
  return `${text.slice(0, MAX_CAPTION_LENGTH - 1).trimEnd()}…`
}

/**
 * Download + match an inbound photo. Logs the vision token spend.
 * Returns the matched product, or a human-readable reason for the
 * handoff note.
 */
async function matchInboundPhoto(args: {
  db: ReturnType<typeof supabaseAdmin>
  accountId: string
  conversationId: string
  config: AiConfig
  products: ProductWithImage[]
  mediaId: string
  caption: string | null
}): Promise<{ product: ProductWithImage | null; reason: string }> {
  const { db, accountId, conversationId, config, products } = args
  if (products.length === 0) {
    return { product: null, reason: 'customer sent a photo; no products in the catalog yet' }
  }
  let accessToken: string
  try {
    ;({ accessToken } = await loadAccountMetaCredentials(db, accountId))
  } catch {
    return { product: null, reason: 'customer sent a photo; it could not be downloaded' }
  }
  const image = await loadInboundPhoto({ mediaId: args.mediaId, accessToken })
  if (!image) {
    return { product: null, reason: 'customer sent a photo; it could not be downloaded' }
  }
  const result = await matchProductPhoto({ config, products, image, caption: args.caption })
  logVisionUsage(db, accountId, conversationId, config, result.usage)
  if (result.status === 'matched' && result.product) {
    return { product: result.product, reason: '' }
  }
  const seen = result.description ? ` (looks like: ${result.description})` : ''
  return {
    product: null,
    reason:
      result.status === 'error'
        ? 'customer sent a photo; the AI could not check it'
        : `customer sent a photo that matches no product${seen}`,
  }
}

function logVisionUsage(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  conversationId: string,
  config: AiConfig,
  usage: AiUsage | null,
): void {
  void logAiUsage(db, {
    accountId,
    conversationId,
    mode: 'auto_reply',
    provider: config.provider,
    model: config.model,
    usage,
  })
}

/**
 * Hand the thread to a human: (a) pause the bot here (sticky until
 * re-enabled), (b) route to the configured handoff agent — null leaves
 * it in the shared queue — (c) leave a short internal note, and (d) send
 * the customer a holding message so they are never left in silence.
 * Assigning fires the `on_conversation_assigned` trigger, which notifies
 * the agent. NEVER throws.
 */
async function handOff(args: {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  config: AiConfig
  messages: ChatMessage[]
  replyCount: number
  /** Extra context for the note (photo not matched, cap reached…). */
  reason: string | null
}): Promise<void> {
  const db = supabaseAdmin()
  try {
    const summary = buildHandoffSummary({
      messages: args.messages,
      replyCount: args.replyCount,
      reason: args.reason,
    })
    await db
      .from('conversations')
      .update({ ai_autoreply_disabled: true, ai_handoff_summary: summary })
      .eq('id', args.conversationId)
    // Only set the assignee when a target is configured AND the thread
    // isn't already owned — never stomp an existing human assignment.
    if (args.config.handoffAgentId) {
      await db
        .from('conversations')
        .update({ assigned_agent_id: args.config.handoffAgentId })
        .eq('id', args.conversationId)
        .is('assigned_agent_id', null)
    }
  } catch (err) {
    console.error('[ai auto-reply] handoff update failed:', err)
  }

  try {
    const lastCustomer =
      [...args.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    await engineSendText({
      accountId: args.accountId,
      userId: args.configOwnerUserId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: holdingMessageFor(args.config.handoffMessage, lastCustomer),
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] holding message failed:', err)
  }
}

async function hasNewerInbound(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  inboundMessageId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return false
  return data[0].message_id !== inboundMessageId
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}
