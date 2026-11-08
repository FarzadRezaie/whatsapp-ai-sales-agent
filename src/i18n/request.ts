import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import en from '../../messages/en.json';
import fa from '../../messages/fa.json';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isAppLocale, withEnglishFallback } from './config';

export default getRequestConfig(async () => {
  // The visitor's own choice (language switcher) wins over the default.
  let locale: string = DEFAULT_LOCALE;
  try {
    const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isAppLocale(chosen)) locale = chosen;
  } catch {
    // No request scope (e.g. static generation) — keep the default.
  }

  const messages = locale === 'fa' ? withEnglishFallback(en, fa) : en;

  return {
    locale,
    messages,
  };
});
