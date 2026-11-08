"use client";

import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { useSwitchLocale } from "./use-switch-locale";
import { cn } from "@/lib/utils";

/** One-tap switch between English and Dari. */
export function LanguageToggle({ className }: { className?: string }) {
  const t = useTranslations("Header");
  const locale = useLocale();
  const { switchLocale, pending } = useSwitchLocale();
  const other = locale === "fa" ? "en" : "fa";
  return (
    <button
      type="button"
      onClick={() => switchLocale(other)}
      disabled={pending}
      title={t("switchLanguage")}
      aria-label={t("switchLanguage")}
      lang={other === "fa" ? "fa-AF" : "en"}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60",
        className,
      )}
    >
      <Languages className="size-4 text-muted-foreground" />
      {other === "fa" ? "دری" : "English"}
    </button>
  );
}
