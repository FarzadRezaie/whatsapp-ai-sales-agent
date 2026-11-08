// ============================================================
// Supported UI languages.
//
// English and Dari. The language can be switched at runtime from the
// account menu (stored in the NEXT_LOCALE cookie); NEXT_PUBLIC_APP_LOCALE
// sets the default for new visitors and the language of server-side
// error messages.
// ============================================================

export const LOCALES = ["en", "fa"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as ReadonlyArray<string>).includes(value);
}

/** Default language: NEXT_PUBLIC_APP_LOCALE when supported, else English. */
export const DEFAULT_LOCALE: AppLocale = isAppLocale(process.env.NEXT_PUBLIC_APP_LOCALE)
  ? process.env.NEXT_PUBLIC_APP_LOCALE
  : "en";

/** Dari is written right-to-left. */
export function localeDirection(locale: string): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}

/** Native names shown in the language switcher. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  fa: "دری",
};

type Catalogue = Record<string, unknown>;

/**
 * Deep-merge a translation over English so any key not yet translated
 * falls back to English instead of rendering a raw key path.
 */
export function withEnglishFallback(en: Catalogue, translated: Catalogue): Catalogue {
  const out: Catalogue = { ...en };
  for (const [key, value] of Object.entries(translated)) {
    const base = out[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base &&
      typeof base === "object" &&
      !Array.isArray(base)
    ) {
      out[key] = withEnglishFallback(base as Catalogue, value as Catalogue);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
