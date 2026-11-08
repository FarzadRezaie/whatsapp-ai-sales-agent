import { describeProduct } from './catalog'
import type { Product } from './types'

/**
 * System-prompt section for a customer photo that was matched to a
 * catalog product. The bot's reply is sent as the CAPTION under the
 * shop's own photo of that product (one WhatsApp message), so the photo
 * itself shows the customer which item is meant — no "is this the one?"
 * round trip, no extra message cost.
 */
export function photoMatchPrompt(product: Product, hasProductPhoto: boolean): string {
  const delivery = hasProductPhoto
    ? "Your reply will be sent as the caption under the shop's own photo of this product, so do not describe the photo."
    : 'Reply in text.'
  return [
    "Customer photo: the customer's latest message is a photo, and it has been identified as this catalog product:",
    describeProduct(product),
    `${delivery} In 1–3 short sentences: name the product and give its price, mention the sizes, colours and stock that matter, and answer any question the customer wrote with the photo. Use only the catalog data above.`,
  ].join('\n')
}
