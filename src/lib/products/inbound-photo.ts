import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import { VISION_MIME_TYPES } from '@/lib/ai/vision'
import type { CustomerImage } from './match'

/** WhatsApp caps images at 5 MB; anything bigger isn't a normal photo. */
const MAX_INBOUND_PHOTO_BYTES = 5 * 1024 * 1024

/**
 * Download a photo a customer sent (by Meta media id) for the vision
 * model. Returns null — never throws — when the media can't be fetched,
 * is too big, or isn't an image type the model accepts.
 */
export async function loadInboundPhoto(args: {
  mediaId: string
  accessToken: string
}): Promise<CustomerImage | null> {
  try {
    const info = await getMediaUrl({ mediaId: args.mediaId, accessToken: args.accessToken })
    if (info.fileSize !== null && info.fileSize > MAX_INBOUND_PHOTO_BYTES) return null
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: info.url,
      accessToken: args.accessToken,
    })
    if (buffer.length === 0 || buffer.length > MAX_INBOUND_PHOTO_BYTES) return null
    const mimeType = (info.mimeType || contentType).split(';')[0].trim().toLowerCase()
    if (!VISION_MIME_TYPES.has(mimeType)) return null
    return { mimeType, base64: buffer.toString('base64') }
  } catch (err) {
    console.error('[products] inbound photo download failed:', err)
    return null
  }
}
