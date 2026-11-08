import type { ProductInput } from './types'

// ============================================================
// Input validation for POST /api/products and PATCH /api/products/[id].
//
// Pure (no DB, no i18n) so it is unit-testable; the routes translate
// the returned error key with getT('Api') under `products.*`.
// ============================================================

/** Hard cap on catalog size per account (keeps prompts and the
 *  products page bounded). */
export const MAX_PRODUCTS_PER_ACCOUNT = 500

export const PRODUCT_LIMITS = {
  category: 60,
  name: 120,
  description: 1000,
  stockNote: 200,
  listItem: 30,
  listItems: 30,
  currency: 8,
  maxPrice: 100_000_000,
} as const

export type ProductValidationError =
  | 'invalidBody'
  | 'categoryRequired'
  | 'nameRequired'
  | 'priceInvalid'
  | 'fieldTooLong'
  | 'imagePathInvalid'

export type ProductValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProductValidationError }

function cleanString(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
}

function cleanMultiline(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Accepts either an array of strings or one comma / Persian-comma (،)
 * separated string — the form sends "S, M, L" but an API caller may
 * send ["S","M","L"]. De-duplicates case-insensitively, keeps order.
 */
export function parseList(v: unknown): string[] | null {
  let parts: unknown[]
  if (Array.isArray(v)) parts = v
  else if (typeof v === 'string') parts = v.split(/[,،\n]/)
  else if (v === null || v === undefined) return []
  else return null

  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    if (typeof p !== 'string') return null
    const s = cleanString(p)
    if (!s) continue
    if (s.length > PRODUCT_LIMITS.listItem) return null
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  if (out.length > PRODUCT_LIMITS.listItems) return null
  return out
}

/** Parses "1,200" / "۱۲۰۰" / 1200 into a non-negative number. */
export function parsePrice(v: unknown): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const western = v
      // Persian (U+06F0–06F9) and Arabic-Indic (U+0660–0669) digits.
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[,\s٬،]/g, '')
      .replace(/٫/g, '.')
    if (!/^\d+(\.\d{1,2})?$/.test(western)) return null
    n = Number(western)
  } else return null
  if (!Number.isFinite(n) || n < 0 || n > PRODUCT_LIMITS.maxPrice) return null
  return Math.round(n * 100) / 100
}

/**
 * Product photos must live in the caller's own account folder in the
 * `product-images` bucket. Rejects anything else (another account's
 * folder, path traversal, a full URL).
 */
export function isValidImagePath(path: string, accountId: string): boolean {
  if (path.length > 300) return false
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return false
  if (!path.startsWith(`account-${accountId}/`)) return false
  return /^[A-Za-z0-9/_.-]+$/.test(path)
}

/**
 * Validate a full product (create). `partial` = true validates only the
 * keys present (update) and returns just those.
 */
export function validateProductInput(
  body: unknown,
  accountId: string,
  partial: boolean,
): ProductValidationResult<Partial<ProductInput>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalidBody' }
  }
  const b = body as Record<string, unknown>
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k)
  const out: Partial<ProductInput> = {}

  if (!partial || has('category')) {
    const category = cleanString(b.category)
    if (!category) return { ok: false, error: 'categoryRequired' }
    if (category.length > PRODUCT_LIMITS.category) return { ok: false, error: 'fieldTooLong' }
    out.category = category
  }

  if (!partial || has('name')) {
    const name = cleanString(b.name)
    if (!name) return { ok: false, error: 'nameRequired' }
    if (name.length > PRODUCT_LIMITS.name) return { ok: false, error: 'fieldTooLong' }
    out.name = name
  }

  if (!partial || has('description')) {
    const description = cleanMultiline(b.description)
    if (description.length > PRODUCT_LIMITS.description) return { ok: false, error: 'fieldTooLong' }
    out.description = description || null
  }

  if (!partial || has('price')) {
    const price = parsePrice(b.price)
    if (price === null) return { ok: false, error: 'priceInvalid' }
    out.price = price
  }

  if (!partial || has('currency')) {
    const currency = cleanString(b.currency).toUpperCase() || 'AFN'
    if (currency.length > PRODUCT_LIMITS.currency) return { ok: false, error: 'fieldTooLong' }
    out.currency = currency
  }

  if (!partial || has('sizes')) {
    const sizes = parseList(b.sizes)
    if (sizes === null) return { ok: false, error: 'fieldTooLong' }
    out.sizes = sizes
  }

  if (!partial || has('colors')) {
    const colors = parseList(b.colors)
    if (colors === null) return { ok: false, error: 'fieldTooLong' }
    out.colors = colors
  }

  if (!partial || has('in_stock')) {
    out.in_stock = b.in_stock === undefined ? true : b.in_stock === true
  }

  if (!partial || has('stock_note')) {
    const note = cleanString(b.stock_note)
    if (note.length > PRODUCT_LIMITS.stockNote) return { ok: false, error: 'fieldTooLong' }
    out.stock_note = note || null
  }

  if (!partial || has('image_path')) {
    const raw = b.image_path
    if (raw === null || raw === undefined || raw === '') {
      out.image_path = null
    } else if (typeof raw !== 'string' || !isValidImagePath(raw, accountId)) {
      return { ok: false, error: 'imagePathInvalid' }
    } else {
      out.image_path = raw
    }
  }

  if (!partial || has('is_active')) {
    out.is_active = b.is_active === undefined ? true : b.is_active === true
  }

  return { ok: true, value: out }
}
