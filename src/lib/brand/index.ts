// ============================================================
// Product branding — the one place to change the product's name.
//
// Set NEXT_PUBLIC_BRAND_NAME (and NEXT_PUBLIC_BRAND_NAME_FA for the
// Dari interface) in .env.local; rebuild after changing.
// ============================================================

export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Shop Assistant";

export const BRAND_NAME_FA = process.env.NEXT_PUBLIC_BRAND_NAME_FA?.trim() || "دستیار فروش";

export function brandName(locale: string): string {
  return locale === "fa" ? BRAND_NAME_FA : BRAND_NAME;
}
