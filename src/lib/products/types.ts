// ============================================================
// Product catalog types (migration 060_products.sql).
//
// One row per product a shop sells. The AI uses the catalog two ways:
//   1. As text in every reply's system prompt, so price / size / stock
//      questions are answered from real data.
//   2. As PHOTOS when a customer sends a picture: the customer's photo
//      is compared with the product photos to find the item.
// ============================================================

export interface Product {
  id: string
  account_id: string
  category: string
  name: string
  description: string | null
  price: number
  currency: string
  sizes: string[]
  colors: string[]
  in_stock: boolean
  stock_note: string | null
  /** Storage object path inside the `product-images` bucket. */
  image_path: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Product + the public URL of its photo (null when it has none). */
export interface ProductWithImage extends Product {
  image_url: string | null
}

/** The editable fields, as accepted by POST/PATCH /api/products. */
export interface ProductInput {
  category: string
  name: string
  description: string | null
  price: number
  currency: string
  sizes: string[]
  colors: string[]
  in_stock: boolean
  stock_note: string | null
  image_path: string | null
  is_active: boolean
}

export const PRODUCT_IMAGES_BUCKET = 'product-images'

/** Columns selected everywhere a product is read. */
export const PRODUCT_COLUMNS =
  'id, account_id, category, name, description, price, currency, sizes, colors, in_stock, stock_note, image_path, is_active, created_at, updated_at'
