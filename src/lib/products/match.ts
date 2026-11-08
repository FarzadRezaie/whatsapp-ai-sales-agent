import type { AiConfig, AiUsage } from '@/lib/ai/types'
import {
  addUsage,
  callVision,
  extractJsonObject,
  VISION_MIME_TYPES,
  type VisionPart,
} from '@/lib/ai/vision'
import type { ProductWithImage } from './types'

// ============================================================
// Customer photo → catalog product.
//
// Compares PICTURES WITH PICTURES (the customer's photo next to the
// shop's own product photos), not text descriptions, so the model sees
// the real pattern, cut and colour.
//
//   Small catalog (≤ MAX_COMPARE products with photos):
//     one call — customer photo + every product photo.
//   Larger catalog:
//     call 1 — which CATEGORY is in the photo? (cheap, reliable)
//     call 2 — customer photo + that category's product photos only.
//
// Both calls also read any text in the photo (a screenshot of the
// shop's own Instagram post often shows the product name or price),
// and products WITHOUT a photo are listed by name so a screenshot can
// still match them.
//
// Never throws: any failure returns status 'error' and the caller
// hands the chat to a human. A wrong price is worse than a slow one.
// ============================================================

/** Max product photos sent in one comparison call. */
export const MAX_COMPARE = 12
/** Skip product photos larger than this when building the request. */
const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024

export type MatchConfidence = 'high' | 'medium' | 'low'

export interface PhotoMatchResult {
  status: 'matched' | 'no_match' | 'no_catalog' | 'error'
  product: ProductWithImage | null
  confidence: MatchConfidence | null
  /** What the customer's photo shows, in a few words (for the handoff note). */
  description: string | null
  /** Text the model could read in the photo, if any. */
  visibleText: string | null
  usage: AiUsage | null
}

export interface CustomerImage {
  mimeType: string
  base64: string
}

type ImageLoader = (url: string) => Promise<CustomerImage | null>

/** Default loader: fetch a product photo from its public URL. */
export async function fetchImageAsBase64(url: string): Promise<CustomerImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!VISION_MIME_TYPES.has(mimeType)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_PRODUCT_IMAGE_BYTES) return null
    return { mimeType, base64: buf.toString('base64') }
  } catch {
    return null
  }
}

const COMMON_RULES =
  'Rules: Only choose a product when you are confident the customer photo shows the SAME item ' +
  '(same type, colour, pattern and design). A similar-looking but different item is NOT a match. ' +
  'If the photo shows several items, judge the most prominent one. ' +
  'If the photo contains readable text (a product name, price or code), use it. ' +
  'Never invent a product. Answer with ONE JSON object only, no other text.'

function confidenceOf(v: unknown): MatchConfidence | null {
  return v === 'high' || v === 'medium' || v === 'low' ? v : null
}

function shortString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

function productLabel(p: ProductWithImage): string {
  const extra = [p.colors.length ? `colours: ${p.colors.join(', ')}` : '', p.description ?? '']
    .filter(Boolean)
    .join('; ')
  return `${p.name} (category: ${p.category}${extra ? `; ${extra.slice(0, 160)}` : ''})`
}

/**
 * Ask which category the photo shows. Returns the category name exactly
 * as stored, or null when the model can't tell / names an unknown one.
 */
async function classifyCategory(
  config: AiConfig,
  categories: string[],
  image: CustomerImage,
  caption: string | null,
): Promise<{ category: string | null; usage: AiUsage | null }> {
  const instruction =
    'You sort photos sent by shop customers into the shop\'s product categories. ' +
    'Answer with ONE JSON object only: {"category": "<one of the listed categories, exactly as written, or empty string>"}.'
  const parts: VisionPart[] = [
    {
      type: 'text',
      text:
        `Shop categories:\n${categories.map((c) => `- ${c}`).join('\n')}\n\n` +
        (caption ? `The customer wrote: "${caption.slice(0, 300)}"\n\n` : '') +
        'Which category does the product in this customer photo belong to?',
    },
    { type: 'image', mimeType: image.mimeType, base64: image.base64 },
  ]
  const { text, usage } = await callVision({ config, instruction, parts })
  const json = extractJsonObject(text)
  const raw = shortString(json?.category, 100)
  if (!raw) return { category: null, usage }
  const exact = categories.find((c) => c === raw)
  const loose = categories.find((c) => c.toLowerCase() === raw.toLowerCase())
  return { category: exact ?? loose ?? null, usage }
}

/**
 * Match a customer photo against the catalog. `products` should be the
 * account's ACTIVE products (see loadActiveProducts).
 */
export async function matchProductPhoto(args: {
  config: AiConfig
  products: ProductWithImage[]
  image: CustomerImage
  caption: string | null
  loadImage?: ImageLoader
}): Promise<PhotoMatchResult> {
  const { config, products, image, caption } = args
  const loadImage = args.loadImage ?? fetchImageAsBase64
  const empty: PhotoMatchResult = {
    status: 'no_catalog',
    product: null,
    confidence: null,
    description: null,
    visibleText: null,
    usage: null,
  }
  if (products.length === 0) return empty
  if (!VISION_MIME_TYPES.has(image.mimeType)) {
    return { ...empty, status: 'error' }
  }

  let usage: AiUsage | null = null
  try {
    const withPhoto = products.filter((p) => !!p.image_url)

    // Narrow by category only when the photo set is too big for one call.
    let pool = withPhoto
    if (withPhoto.length > MAX_COMPARE) {
      const categories = Array.from(new Set(withPhoto.map((p) => p.category)))
      const cls = await classifyCategory(config, categories, image, caption)
      usage = addUsage(usage, cls.usage)
      if (cls.category) {
        pool = withPhoto.filter((p) => p.category === cls.category)
      }
    }
    const candidates = pool.slice(0, MAX_COMPARE)

    // Load candidate photos in parallel; a photo that fails to load is
    // listed by name only (still matchable from text in the screenshot).
    const loaded = await Promise.all(candidates.map((p) => loadImage(p.image_url as string)))

    // Number every product the model may pick: photo candidates first,
    // then text-only products (no photo, or a photo that failed to load).
    const numbered: ProductWithImage[] = []
    const parts: VisionPart[] = [
      {
        type: 'text',
        text:
          'IMAGE 0 is the photo the CUSTOMER sent' +
          (caption ? `, with this message: "${caption.slice(0, 300)}"` : '') +
          '.',
      },
      { type: 'image', mimeType: image.mimeType, base64: image.base64 },
    ]
    candidates.forEach((p, i) => {
      const img = loaded[i]
      if (!img) return
      numbered.push(p)
      parts.push({ type: 'text', text: `PRODUCT ${numbered.length}: ${productLabel(p)}` })
      parts.push({ type: 'image', mimeType: img.mimeType, base64: img.base64 })
    })
    const textOnly = products.filter(
      (p) => !numbered.includes(p) && (!p.image_url || candidates.includes(p)),
    )
    if (textOnly.length > 0) {
      const lines = textOnly.slice(0, 60).map((p) => {
        numbered.push(p)
        return `PRODUCT ${numbered.length}: ${productLabel(p)} — no photo`
      })
      parts.push({
        type: 'text',
        text: `Products without a photo (match these ONLY from readable text in the customer photo):\n${lines.join('\n')}`,
      })
    }
    if (numbered.length === 0) return { ...empty, usage }

    parts.push({
      type: 'text',
      text:
        'Which PRODUCT number is the item in the customer photo? Answer: ' +
        '{"match": <product number, or 0 if none>, "confidence": "high" | "medium" | "low", ' +
        '"description": "<the item in the customer photo in at most 12 words>", ' +
        '"visible_text": "<text readable in the customer photo, or empty>"}',
    })

    const instruction =
      'You help an online shop identify which of its products a customer is asking about from a photo. ' +
      COMMON_RULES +
      ' confidence: "high" = clearly the same item; "medium" = very likely the same item; "low" = unsure.'

    const { text, usage: u } = await callVision({ config, instruction, parts })
    usage = addUsage(usage, u)
    const json = extractJsonObject(text)
    const n = Number(json?.match)
    const confidence = confidenceOf(json?.confidence)
    const description = shortString(json?.description, 160)
    const visibleText = shortString(json?.visible_text, 300)

    if (
      Number.isInteger(n) &&
      n >= 1 &&
      n <= numbered.length &&
      (confidence === 'high' || confidence === 'medium')
    ) {
      return {
        status: 'matched',
        product: numbered[n - 1],
        confidence,
        description,
        visibleText,
        usage,
      }
    }
    return {
      status: 'no_match',
      product: null,
      confidence,
      description,
      visibleText,
      usage,
    }
  } catch (err) {
    console.error('[products] photo match failed:', err)
    return { ...empty, status: 'error', usage }
  }
}
