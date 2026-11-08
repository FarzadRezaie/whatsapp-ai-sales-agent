"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type AppLocale } from "@/i18n/config";

/** Switch the interface language: store the choice and re-render. */
export function useSwitchLocale(): {
  switchLocale: (next: AppLocale) => void;
  pending: boolean;
} {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const switchLocale = useCallback(
    (next: AppLocale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      // The <html dir/lang> attributes come from the server layout, so
      // a refresh re-renders the whole tree in the new language.
      startTransition(() => router.refresh());
    },
    [router],
  );
  return { switchLocale, pending };
}
