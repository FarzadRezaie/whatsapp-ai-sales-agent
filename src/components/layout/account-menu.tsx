"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  Languages,
  LogOut,
  Moon,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sun,
  User,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useUiMode } from "@/hooks/use-ui-mode";
import { LOCALES, LOCALE_LABELS } from "@/i18n/config";
import { useSwitchLocale } from "./use-switch-locale";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const itemClass =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-popover-foreground focus:bg-accent focus:text-accent-foreground";

/**
 * The account menu (top-right avatar): profile, settings, interface
 * language, light / dark appearance, simple / advanced interface, and
 * sign out — every personal preference in one place.
 */
export function AccountMenu() {
  const t = useTranslations("AccountMenu");
  const locale = useLocale();
  const { profile, signOut } = useAuth();
  const { mode, setMode } = useTheme();
  const { isAdvanced, setUiMode } = useUiMode();
  const { switchLocale } = useSwitchLocale();

  const name = profile?.full_name ?? t("defaultUser");
  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted sm:pe-3"
        aria-label={t("open")}
      >
        <Avatar className="size-8">
          {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt={name} /> : null}
          <AvatarFallback className="bg-primary-soft text-sm font-semibold text-primary">
            {initial}
          </AvatarFallback>
        </Avatar>
        <span className="hidden max-w-36 truncate text-sm font-medium text-foreground sm:inline">
          {name}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lift"
      >
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{profile?.email ?? ""}</p>
        </div>
        <DropdownMenuSeparator className="bg-border" />

        <DropdownMenuItem render={<Link href="/settings?tab=profile" className={itemClass} />}>
          <User className="size-4 text-muted-foreground" />
          {t("profile")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings" className={itemClass} />}>
          <SettingsIcon className="size-4 text-muted-foreground" />
          {t("settings")}
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-border" />

        {/* Language */}
        <p className="flex items-center gap-2 px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
          <Languages className="size-3.5" />
          {t("language")}
        </p>
        <div className="grid grid-cols-2 gap-1 px-1.5 pb-1.5">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => l !== locale && switchLocale(l)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm transition-colors",
                l === locale
                  ? "border-primary bg-primary-soft font-medium text-primary"
                  : "border-border text-foreground hover:bg-muted",
              )}
              lang={l === "fa" ? "fa-AF" : "en"}
            >
              {l === locale && <Check className="size-3.5" />}
              {LOCALE_LABELS[l]}
            </button>
          ))}
        </div>

        {/* Appearance */}
        <p className="px-2.5 pb-1 pt-1 text-xs font-medium text-muted-foreground">
          {t("appearance")}
        </p>
        <div className="grid grid-cols-2 gap-1 px-1.5 pb-1.5">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm transition-colors",
                m === mode
                  ? "border-primary bg-primary-soft font-medium text-primary"
                  : "border-border text-foreground hover:bg-muted",
              )}
            >
              {m === "light" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              {m === "light" ? t("light") : t("dark")}
            </button>
          ))}
        </div>

        <DropdownMenuSeparator className="bg-border" />

        <DropdownMenuItem
          onClick={() => setUiMode(isAdvanced ? "simple" : "advanced")}
          className={itemClass}
        >
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <span className="flex-1">{t("advanced")}</span>
          <span
            className={cn(
              "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
              isAdvanced ? "bg-primary" : "bg-border",
            )}
            aria-hidden="true"
          >
            <span
              className={cn(
                "absolute size-3 rounded-full bg-card shadow-sm transition-all",
                isAdvanced ? "start-3.5" : "start-0.5",
              )}
            />
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem onClick={signOut} className={cn(itemClass, "text-destructive focus:text-destructive")}>
          <LogOut className="size-4" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
