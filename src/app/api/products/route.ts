import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { productImageUrl } from '@/lib/products/catalog'
import { MAX_PRODUCTS_PER_ACCOUNT, validateProductInput } from '@/lib/products/validate'
import { PRODUCT_COLUMNS, type Product } from '@/lib/products/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * GET /api/products
 *
 * Every product of the caller's account (active and hidden), with the
 * public photo URL. Any member may read.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('account_id', accountId)
      .order('category', { ascending: true })
      .order('name', { ascending: true })
      .limit(MAX_PRODUCTS_PER_ACCOUNT)
    if (error) {
      console.error('[products GET] error:', error)
      return NextResponse.json({ error: t('products.loadFailed') }, { status: 500 })
    }
    const products = ((data ?? []) as Product[]).map((p) => ({
      ...p,
      price: Number(p.price),
      image_url: productImageUrl(supabase, p.image_path),
    }))
    return NextResponse.json({ products })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/products  (admin+)
 *
 * Create a product. The photo is uploaded by the browser straight to
 * the `product-images` bucket first (RLS-guarded); this receives only
 * its storage path, which must be inside the caller's account folder.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`products:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const parsed = validateProductInput(body, accountId, false)
    if (!parsed.ok) {
      return NextResponse.json({ error: t(`products.${parsed.error}`) }, { status: 400 })
    }

    const { count } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if ((count ?? 0) >= MAX_PRODUCTS_PER_ACCOUNT) {
      return NextResponse.json(
        { error: t('products.limitReached', { max: MAX_PRODUCTS_PER_ACCOUNT }) },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('products')
      .insert({ ...parsed.value, account_id: accountId, created_by: userId })
      .select(PRODUCT_COLUMNS)
      .single()
    if (error || !data) {
      console.error('[products POST] insert error:', error)
      return NextResponse.json({ error: t('products.saveFailed') }, { status: 500 })
    }
    const product = data as Product
    return NextResponse.json({
      product: {
        ...product,
        price: Number(product.price),
        image_url: productImageUrl(supabase, product.image_path),
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
