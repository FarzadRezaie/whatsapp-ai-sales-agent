import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { isUuid } from '@/lib/api/v1/pagination'
import { productImageUrl } from '@/lib/products/catalog'
import { validateProductInput } from '@/lib/products/validate'
import {
  PRODUCT_COLUMNS,
  PRODUCT_IMAGES_BUCKET,
  type Product,
} from '@/lib/products/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

function notFound() {
  return NextResponse.json({ error: t('common.notFound') }, { status: 404 })
}

/** Best-effort removal of a replaced / orphaned product photo. */
async function removePhoto(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  path: string | null,
): Promise<void> {
  if (!path) return
  try {
    const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path])
    if (error) console.warn('[products] photo cleanup failed:', error.message)
  } catch (err) {
    console.warn('[products] photo cleanup threw:', err)
  }
}

/**
 * PATCH /api/products/[id]  (admin+)
 *
 * Update any subset of fields. Replacing or clearing the photo removes
 * the old file from storage.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`products:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    if (!isUuid(id)) return notFound()

    const body = await request.json().catch(() => null)
    const parsed = validateProductInput(body, accountId, true)
    if (!parsed.ok) {
      return NextResponse.json({ error: t(`products.${parsed.error}`) }, { status: 400 })
    }

    const { data: existing, error: loadErr } = await supabase
      .from('products')
      .select('id, image_path')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (loadErr) {
      console.error('[products PATCH] load error:', loadErr)
      return NextResponse.json({ error: t('products.saveFailed') }, { status: 500 })
    }
    if (!existing) return notFound()

    const update = parsed.value
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: t('products.invalidBody') }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('products')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(PRODUCT_COLUMNS)
      .single()
    if (error || !data) {
      console.error('[products PATCH] update error:', error)
      return NextResponse.json({ error: t('products.saveFailed') }, { status: 500 })
    }

    const oldPath = (existing as { image_path: string | null }).image_path
    if ('image_path' in update && oldPath && oldPath !== update.image_path) {
      await removePhoto(supabase, oldPath)
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

/** DELETE /api/products/[id]  (admin+) — also removes its photo. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`products:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    if (!isUuid(id)) return notFound()

    const { data, error } = await supabase
      .from('products')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('image_path')
    if (error) {
      console.error('[products DELETE] error:', error)
      return NextResponse.json({ error: t('products.deleteFailed') }, { status: 500 })
    }
    if (!data || data.length === 0) return notFound()
    await removePhoto(supabase, (data[0] as { image_path: string | null }).image_path)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
