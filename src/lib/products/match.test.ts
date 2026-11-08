import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiConfig } from '@/lib/ai/types'
import type { ProductWithImage } from './types'

const h = vi.hoisted(() => ({ callVision: vi.fn() }))
vi.mock('@/lib/ai/vision', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/vision')>('@/lib/ai/vision')
  return { ...actual, callVision: h.callVision }
})

import { MAX_COMPARE, matchProductPhoto } from './match'

const CONFIG: AiConfig = {
  provider: 'openai',
  model: 'm',
  baseUrl: null,
  apiKey: 'k',
  systemPrompt: null,
  isActive: true,
  autoReplyEnabled: true,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
  embeddingsApiKey: null,
}
const IMAGE = { mimeType: 'image/jpeg', base64: 'QUJD' }
const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 }

function product(i: number, overrides: Partial<ProductWithImage> = {}): ProductWithImage {
  return {
    id: `p${i}`,
    account_id: 'a',
    category: 'Shirts',
    name: `Product ${i}`,
    description: null,
    price: 100 * i,
    currency: 'AFN',
    sizes: [],
    colors: [],
    in_stock: true,
    stock_note: null,
    image_path: `account-a/${i}.jpg`,
    image_url: `https://cdn/${i}.jpg`,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const loadImage = vi.fn(async () => ({ mimeType: 'image/jpeg', base64: 'UFJE' }))

beforeEach(() => {
  h.callVision.mockReset()
  loadImage.mockClear()
})

describe('matchProductPhoto', () => {
  it('returns no_catalog without calling the model for an empty catalog', async () => {
    const r = await matchProductPhoto({ config: CONFIG, products: [], image: IMAGE, caption: null, loadImage })
    expect(r.status).toBe('no_catalog')
    expect(h.callVision).not.toHaveBeenCalled()
  })

  it('small catalog: ONE call comparing the photo with every product photo', async () => {
    h.callVision.mockResolvedValue({ text: '{"match": 2, "confidence": "high", "description": "shirt"}', usage: USAGE })
    const products = [product(1), product(2), product(3)]
    const r = await matchProductPhoto({ config: CONFIG, products, image: IMAGE, caption: 'price?', loadImage })
    expect(h.callVision).toHaveBeenCalledTimes(1)
    const parts = h.callVision.mock.calls[0][0].parts
    // customer photo + 3 product photos
    expect(parts.filter((p: { type: string }) => p.type === 'image')).toHaveLength(4)
    expect(JSON.stringify(parts)).toContain('price?')
    expect(r.status).toBe('matched')
    expect(r.product?.id).toBe('p2')
    expect(r.usage).toEqual(USAGE)
  })

  it('large catalog: classifies the category first, then compares only that category', async () => {
    const shirts = Array.from({ length: 8 }, (_, i) => product(i + 1))
    const jackets = Array.from({ length: 8 }, (_, i) =>
      product(i + 101, { category: 'Jackets', name: `Jacket ${i + 1}` }),
    )
    expect(shirts.length + jackets.length).toBeGreaterThan(MAX_COMPARE)
    h.callVision
      .mockResolvedValueOnce({ text: '{"category": "jackets"}', usage: USAGE })
      .mockResolvedValueOnce({ text: '{"match": 3, "confidence": "medium"}', usage: USAGE })
    const r = await matchProductPhoto({
      config: CONFIG,
      products: [...shirts, ...jackets],
      image: IMAGE,
      caption: null,
      loadImage,
    })
    expect(h.callVision).toHaveBeenCalledTimes(2)
    expect(loadImage).toHaveBeenCalledTimes(8)
    expect(r.status).toBe('matched')
    expect(r.product?.category).toBe('Jackets')
    expect(r.product?.name).toBe('Jacket 3')
    expect(r.usage?.totalTokens).toBe(4)
  })

  it('treats low confidence or match 0 as no_match (never guesses)', async () => {
    h.callVision.mockResolvedValueOnce({ text: '{"match": 1, "confidence": "low"}', usage: null })
    let r = await matchProductPhoto({ config: CONFIG, products: [product(1)], image: IMAGE, caption: null, loadImage })
    expect(r.status).toBe('no_match')
    expect(r.product).toBeNull()

    h.callVision.mockResolvedValueOnce({ text: '{"match": 0, "confidence": "high", "description": "a cat"}', usage: null })
    r = await matchProductPhoto({ config: CONFIG, products: [product(1)], image: IMAGE, caption: null, loadImage })
    expect(r.status).toBe('no_match')
    expect(r.description).toBe('a cat')
  })

  it('rejects an out-of-range product number', async () => {
    h.callVision.mockResolvedValue({ text: '{"match": 9, "confidence": "high"}', usage: null })
    const r = await matchProductPhoto({ config: CONFIG, products: [product(1)], image: IMAGE, caption: null, loadImage })
    expect(r.status).toBe('no_match')
  })

  it('lists products without a photo by name so screenshot text can match them', async () => {
    h.callVision.mockResolvedValue({ text: '{"match": 2, "confidence": "high"}', usage: null })
    const noPhoto = product(2, { image_url: null, image_path: null, name: 'Kandahari cap' })
    const r = await matchProductPhoto({
      config: CONFIG,
      products: [product(1), noPhoto],
      image: IMAGE,
      caption: null,
      loadImage,
    })
    expect(JSON.stringify(h.callVision.mock.calls[0][0].parts)).toContain('PRODUCT 2: Kandahari cap (category: Shirts) — no photo')
    expect(r.product?.name).toBe('Kandahari cap')
  })

  it('returns status error (and does not throw) when the provider fails', async () => {
    h.callVision.mockRejectedValue(new Error('429'))
    const r = await matchProductPhoto({ config: CONFIG, products: [product(1)], image: IMAGE, caption: null, loadImage })
    expect(r.status).toBe('error')
  })

  it('returns error for an unsupported customer image type', async () => {
    const r = await matchProductPhoto({
      config: CONFIG,
      products: [product(1)],
      image: { mimeType: 'image/heic', base64: 'AA' },
      caption: null,
      loadImage,
    })
    expect(r.status).toBe('error')
    expect(h.callVision).not.toHaveBeenCalled()
  })
})
