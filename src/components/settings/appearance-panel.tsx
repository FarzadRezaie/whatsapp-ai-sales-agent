"use client";

import { Check, Languages, Moon, SlidersHorizontal, Sun, SunMoon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { useTheme } from "@/hooks/use-theme";
import { useUiMode } from "@/hooks/use-ui-mode";
import { MODES, type Mode } from "@/lib/themes";
import { LOCALES, LOCALE_LABELS, type AppLocale } from "@/i18n/config";
import { useSwitchLocale } from "@/components/layout/use-switch-locale";
import { cn } from "@/lib/utils";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Appearance: light / dark mode, interface language and the simple /
 * advanced interface. Every choice applies immediately (no save).
 * Mode and interface are per device; language is stored in a cookie.
 */
export function AppearancePanel() {
  const { mode, setMode } = useTheme();
  const { uiMode, setUiMode } = useUiMode();
  const locale = useLocale() as AppLocale;
  const { switchLocale } = useSwitchLocale();
  const t = useTranslations("Settings.appearance");

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <div className="space-y-8">
        <Group icon={SunMoon} title={t("mode")}>
          <div role="radiogroup" aria-label={t("colorMode")} className="grid max-w-md grid-cols-2 gap-3">
            {MODES.map((m) => (
              <Choice
                key={m}
                active={m === mode}
                onPick={() => setMode(m)}
                icon={m === "light" ? Sun : Moon}
                label={m === "light" ? t("light") : t("dark")}
                activeLabel={t("active")}
              />
            ))}
          </div>
        </Group>

        <Group icon={Languages} title={t("language")}>
          <div role="radiogroup" aria-label={t("language")} className="grid max-w-md grid-cols-2 gap-3">
            {LOCALES.map((l) => (
              <Choice
                key={l}
                active={l === locale}
                onPick={() => l !== locale && switchLocale(l)}
                label={LOCALE_LABELS[l]}
                activeLabel={t("active")}
                lang={l === "fa" ? "fa-AF" : "en"}
              />
            ))}
          </div>
        </Group>

        <Group icon={SlidersHorizontal} title={t("interface")}>
          <p className="-mt-2 mb-3 max-w-xl text-sm text-muted-foreground">{t("interfaceDesc")}</p>
          <div role="radiogroup" aria-label={t("interface")} className="grid max-w-md grid-cols-2 gap-3">
            {(["simple", "advanced"] as const).map((m) => (
              <Choice
                key={m}
                active={m === uiMode}
                onPick={() => setUiMode(m)}
                label={m === "simple" ? t("interfaceSimple") : t("interfaceAdvanced")}
                activeLabel={t("active")}
              />
            ))}
          </div>
        </Group>
      </div>
    </section>
  );
}

function Group({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sun;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function Choice({
  active,
  onPick,
  icon: Icon,
  label,
  activeLabel,
  lang,
}: {
  active: boolean;
  onPick: () => void;
  icon?: typeof Sun;
  label: string;
  activeLabel: string;
  lang?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      lang={lang}
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card p-4 text-start shadow-soft transition-colors",
        active ? "border-primary ring-2 ring-primary/25" : "border-border hover:bg-muted/50",
      )}
    >
      {Icon && (
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="flex-1 text-sm font-semibold text-foreground">{label}</span>
      {active && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
          <Check className="size-3" />
          {activeLabel}
        </span>
      )}
    </button>
  );
}

export type { Mode };
