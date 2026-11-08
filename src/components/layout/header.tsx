"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";

import { AccountMenu } from "@/components/layout/account-menu";
import { LanguageToggle } from "./language-toggle";

const pageTitles: Record<string, string> = {
  "/dashboard": "home",
  "/inbox": "inbox",
  "/notifications": "notifications",
  "/contacts": "contacts",
  "/pipelines": "pipelines",
  "/broadcasts": "broadcasts",
  "/automations": "automations",
  "/flows": "flows",
  "/products": "products",
  "/agents": "aiAgents",
  "/settings": "settings",
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) => pathname.startsWith(path));
  return match ? match[1] : "home";
}

interface HeaderProps {
  /** Opens the sidebar drawer — mobile only. */
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations("Header");
  const pathname = usePathname();
  const titleKey = getPageTitleKey(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("openMenu")}
          className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="size-5" />
        </button>
        {/* Pages carry their own headings on desktop; the bar title
            orients mobile users, where the sidebar is hidden. */}
        <p className="truncate text-base font-semibold text-foreground lg:hidden">
          {t(titleKey)}
        </p>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* One-tap language switch — the same choice is in the account menu. */}
        <LanguageToggle />
        <AccountMenu />
      </div>
    </header>
  );
}
