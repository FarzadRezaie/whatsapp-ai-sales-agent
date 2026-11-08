import { createTranslator } from 'next-intl';
import en from '../../../messages/en.json';
import fa from '../../../messages/fa.json';
import { DEFAULT_LOCALE, withEnglishFallback } from '@/i18n/config';

/**
 * Translator for code that runs outside React — API route handlers,
 * validators shared by client and server, starter templates, and so on.
 * Components should keep using `useTranslations` / `getTranslations`.
 *
 * Server-side messages (API errors, bot defaults) use the deployment's
 * default language (NEXT_PUBLIC_APP_LOCALE: 'en' or 'fa'); the UI
 * language itself can be switched per visitor. Untranslated Dari keys
 * fall back to English. The test suite sees English.
 */

type Catalogue = Record<string, unknown>;

function loadCatalogue(): { locale: string; messages: Catalogue } {
  const locale = DEFAULT_LOCALE;
  const messages = locale === 'fa' ? withEnglishFallback(en, fa) : (en as Catalogue);
  return { locale, messages };
}

let cached: { locale: string; messages: Catalogue } | null = null;

export type TranslateValues = Record<string, string | number | Date>;
export type Translate = (key: string, values?: TranslateValues) => string;

/**
 * Returns a `t(key, values)` bound to `namespace` (e.g. `'Api'`,
 * `'Validation.flows'`). Messages use ICU syntax like the rest of the
 * catalogue; literal WhatsApp `{{1}}` must be passed in as a value.
 */
export function getT(namespace: string): Translate {
  cached ??= loadCatalogue();
  const t = createTranslator({
    locale: cached.locale,
    messages: cached.messages,
    namespace: namespace as never,
  }) as unknown as (key: string, values?: TranslateValues) => string;
  return (key, values) => t(key, values);
}
