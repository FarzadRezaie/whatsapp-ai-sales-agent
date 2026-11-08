"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Bell,
  Bot,
  GitBranch,
  Home,
  MessageSquare,
  Package,
  Radio,
  Settings,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useUiMode } from "@/hooks/use-ui-mode";
import { brandName } from "@/lib/brand";
import { Logo } from "@/components/brand/logo";

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof Home;
  /** Small "Beta" chip after the label. Informational only. */
  beta?: boolean;
}

/** What every shop needs — always visible. */
const coreItems: NavItem[] = [
  { href: "/dashboard", labelKey: "home", icon: Home },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
  { href: "/products", labelKey: "products", icon: Package },
  { href: "/agents", labelKey: "aiAgents", icon: Bot },
  { href: "/notifications", labelKey: "notifications", icon: Bell },
];

/** The full CRM — shown with "advanced features" on. */
const advancedItems: NavItem[] = [
  { href: "/contacts", labelKey: "contacts", icon: Users },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
  { href: "/automations", labelKey: "automations", icon: Zap },
  { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's menu button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const locale = useLocale();
  const pathname = usePathname();
  const { profileLoading, profile, account } = useAuth();
  const { isAdvanced } = useUiMode();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();

  // Show the account name only when it says something new (a shared or
  // renamed account) — a solo account is named after its owner.
  const showAccountStrip =
    !profileLoading && !!account?.name && account.name !== profile?.full_name;

  // Close the mobile drawer after navigating.
  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll + Escape to close while the drawer is open (mobile).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  const renderItem = (item: NavItem) => {
    const active = isActive(item.href);
    const showUnreadDot = item.href === "/inbox" && totalUnread > 0 && !active;
    const showNotificationBadge = item.href === "/notifications" && unreadNotifications > 0;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors lg:py-2",
            active
              ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
              : "font-medium text-sidebar-foreground/75 hover:bg-muted hover:text-sidebar-foreground",
          )}
        >
          {active && (
            <span
              className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-primary"
              aria-hidden="true"
            />
          )}
          <item.icon
            className={cn(
              "size-[18px] shrink-0",
              active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
            )}
          />
          <span className="flex-1 truncate">{t(item.labelKey)}</span>
          {item.beta && (
            <span className="rounded-full bg-brand-highlight/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {t("beta")}
            </span>
          )}
          {showUnreadDot && (
            <span
              aria-label={t("unreadConversations", { count: totalUnread })}
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground"
            >
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
          {showNotificationBadge && (
            <span
              aria-label={t("unreadNotifications", { count: unreadNotifications })}
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-highlight px-1.5 text-[10px] font-semibold text-amber-950"
            >
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-foreground/20 backdrop-blur-[2px] transition-opacity lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 start-0 z-40 flex h-full w-[264px] flex-col border-e border-sidebar-border bg-sidebar",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
          "lg:static lg:z-0 lg:w-[248px] lg:translate-x-0 lg:transition-none rtl:lg:translate-x-0",
        )}
        aria-label={t("primaryNav")}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
          <Link href="/dashboard" className="min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo name={brandName(locale)} />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
          <ul className="flex flex-col gap-0.5">{coreItems.map(renderItem)}</ul>

          {isAdvanced && (
            <>
              <p className="mb-1.5 mt-6 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {t("moreTools")}
              </p>
              <ul className="flex flex-col gap-0.5">{advancedItems.map(renderItem)}</ul>
            </>
          )}
        </nav>

        <div className="shrink-0 space-y-2 border-t border-sidebar-border p-3">
          {showAccountStrip && account?.name ? (
            <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
            </div>
          ) : null}
          <ul>
            {renderItem({ href: "/settings", labelKey: "settings", icon: Settings })}
          </ul>
        </div>
      </aside>
    </>
  );
}
