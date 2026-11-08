import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PRODUCT_COLUMNS,
  PRODUCT_IMAGES_BUCKET,
  type Product,
  type ProductWithImage,
} from './types'

// ============================================================
// Reading the catalog for the AI.
// ============================================================

/** Upper bound on products put into one prompt. A shop with more than
 *  this still works — the newest MAX are listed — but the prompt stays
 *  bounded so token cost per reply can't grow without limit. */
export const MAX_PROMPT_PRODUCTS = 150

/** Public URL for a product photo (the bucket is public so Meta can
 *  fetch it when the bot sends the photo to a customer). */
export function productImageUrl(
  db: SupabaseClient,
  imagePath: string | null,
): string | null {
  if (!imagePath) return null
  const { data } = db.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(imagePath)
  return data?.publicUrl ?? null
}

/**
 * Active products for an account, newest first, with public image URLs.
 * Never throws: on a DB error it logs and returns [] so a catalog
 * problem degrades to "no catalog" instead of breaking the reply.
 */
export async function loadActiveProducts(
  db: SupabaseClient,
  accountId: string,
  limit: number = MAX_PROMPT_PRODUCTS,
): Promise<ProductWithImage[]> {
  try {
    const { data, error } = await db
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (error) {
      console.error('[products] loadActiveProducts failed:', error.message)
      return []
    }
    return ((data ?? []) as Product[]).map((p) => ({
      ...p,
      price: Number(p.price),
      sizes: p.sizes ?? [],
      colors: p.colors ?? [],
      image_url: productImageUrl(db, p.image_path),
    }))
  } catch (err) {
    console.error('[products] loadActiveProducts threw:', err)
    return []
  }
}

/** "1,200 AFN" — grouping with commas, no decimals unless needed. */
export function formatPrice(price: number, currency: string): string {
  const rounded = Math.round(price * 100) / 100
  const str = Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${str} ${currency}`
}

/** One product as a compact line block for the prompt. */
export function describeProduct(p: Product): string {
  const lines = [
    `- ${p.name} | category: ${p.category} | price: ${formatPrice(Number(p.price), p.currency)}`,
  ]
  if (p.sizes.length > 0) lines.push(`  sizes: ${p.sizes.join(', ')}`)
  if (p.colors.length > 0) lines.push(`  colors: ${p.colors.join(', ')}`)
  lines.push(`  stock: ${p.in_stock ? 'IN STOCK' : 'OUT OF STOCK'}${p.stock_note ? ` (${p.stock_note})` : ''}`)
  if (p.description) lines.push(`  details: ${p.description.replace(/\s+/g, ' ').trim()}`)
  return lines.join('\n')
}

/**
 * The catalog as a system-prompt section. Grouped by category so the
 * model can answer "what jackets do you have?" in one pass. Returns
 * null for an empty catalog (no section at all).
 */
export function formatCatalogForPrompt(products: Product[]): string | null {
  if (products.length === 0) return null
  const byCategory = new Map<string, Product[]>()
  for (const p of products) {
    const list = byCategory.get(p.category) ?? []
    list.push(p)
    byCategory.set(p.category, list)
  }
  const blocks: string[] = []
  for (const [category, list] of byCategory) {
    blocks.push(`## ${category}\n${list.map(describeProduct).join('\n')}`)
  }
  return blocks.join('\n\n')
}
