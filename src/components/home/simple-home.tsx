"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Circle,
  MessageSquare,
  Package,
  PlugZap,
  Sparkles,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { cn } from "@/lib/utils";

interface AiStatus {
  configured: boolean;
  is_active?: boolean;
  auto_reply_enabled?: boolean;
  monthly_reply_cap?: number | null;
  month_usage?: { bot_messages: number; agent_messages: number; total: number } | null;
}

interface ProductLite {
  image_path: string | null;
  is_active: boolean;
}

/** Meta's monthly free allowance of service replies per number. */
const FREE_MONTHLY_REPLIES = 1000;

// Rendered only on the client (the dashboard shell waits for auth before
// rendering pages), so reading the local clock here is safe.
function useGreetingKey(): "morning" | "afternoon" | "evening" {
  const [key] = useState<"morning" | "afternoon" | "evening">(() => {
    const h = new Date().getHours();
    return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  });
  return key;
}

/**
 * Home screen of the simple interface: is the assistant working, what
 * needs attention, how much of this month's allowance is used, and the
 * few steps left to finish setup.
 */
export function SimpleHome() {
  const t = useTranslations("Home");
  const { profile } = useAuth();
  const unread = useTotalUnread();
  const greeting = useGreetingKey();

  const [ai, setAi] = useState<AiStatus | null>(null);
  const [whatsapp, setWhatsapp] = useState<"connected" | "disconnected" | null>(null);
  const [products, setProducts] = useState<ProductLite[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async <T,>(url: string): Promise<T | null> => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return null;
        return (await res.json()) as T;
      } catch {
        return null;
      }
    };
    void (async () => {
      const [aiRes, waRes, prodRes] = await Promise.all([
        load<AiStatus>("/api/ai/config"),
        load<{ state?: string }>("/api/whatsapp/health"),
        load<{ products?: ProductLite[] }>("/api/products"),
      ]);
      if (cancelled) return;
      setAi(aiRes ?? { configured: false });
      setWhatsapp(waRes?.state === "connected" ? "connected" : "disconnected");
      setProducts(prodRes?.products ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loaded = ai !== null && whatsapp !== null && products !== null;
  const activeProducts = (products ?? []).filter((p) => p.is_active);
  const withPhoto = activeProducts.filter((p) => !!p.image_path).length;
  const assistantLive = !!ai?.configured && !!ai.is_active && !!ai.auto_reply_enabled;
  const usage = ai?.month_usage ?? null;
  const cap = ai?.monthly_reply_cap ?? null;
  const limit = cap ?? FREE_MONTHLY_REPLIES;
  const usedPct = usage ? Math.min(100, Math.round((usage.total / limit) * 100)) : 0;

  const steps = [
    { key: "stepWhatsapp", done: whatsapp === "connected", href: "/settings?tab=whatsapp" },
    { key: "stepAi", done: !!ai?.configured, href: "/agents" },
    { key: "stepProducts", done: activeProducts.length > 0 && withPhoto > 0, href: "/products" },
    { key: "stepAutoReply", done: assistantLive, href: "/agents" },
  ] as const;
  const doneCount = steps.filter((s) => s.done).length;

  const firstName = (profile?.full_name ?? "").split(" ")[0];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {firstName ? t(`greeting.${greeting}`, { name: firstName }) : t("greetingNoName")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Assistant status */}
      <div
        className={cn(
          "flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between",
          !loaded
            ? "border-border bg-card"
            : assistantLive
              ? "border-primary/25 bg-primary-soft"
              : "border-amber-500/30 bg-amber-500/10",
        )}
      >
        <div className="flex items-start gap-4">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl",
              assistantLive ? "bg-primary text-primary-foreground" : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
            )}
          >
            <Bot className="size-5" />
          </span>
          <div>
            <p className="font-semibold text-foreground">
              {!loaded ? t("statusLoading") : assistantLive ? t("statusLive") : t("statusOff")}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {!loaded ? " " : assistantLive ? t("statusLiveDesc") : t("statusOffDesc")}
            </p>
          </div>
        </div>
        <Link
          href="/agents"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-soft transition-colors hover:bg-muted"
        >
          {assistantLive ? t("testAssistant") : t("setUpAssistant")}
          <ArrowUpRight className="size-4 rtl:-scale-x-100" />
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={MessageSquare}
          label={t("unreadChats")}
          value={unread}
          hint={unread > 0 ? t("unreadHint") : t("allCaughtUp")}
          href="/inbox"
          highlight={unread > 0}
        />
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">{t("messagesThisMonth")}</p>
            <Sparkles className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-foreground">
            {usage ? usage.total.toLocaleString("en-US") : "—"}
            <span className="ms-1.5 text-sm font-normal text-muted-foreground">
              / {limit.toLocaleString("en-US")}
            </span>
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                usedPct >= 100 ? "bg-red-500" : usedPct >= 80 ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {cap ? t("planLimit") : t("freeAllowance")}
          </p>
        </div>
        <StatCard
          icon={Bot}
          label={t("assistantReplies")}
          value={usage?.bot_messages ?? 0}
          hint={t("assistantRepliesHint")}
          href="/agents"
        />
        <StatCard
          icon={Package}
          label={t("products")}
          value={activeProducts.length}
          hint={
            activeProducts.length === 0
              ? t("productsEmpty")
              : withPhoto < activeProducts.length
                ? t("productsMissingPhotos", { count: activeProducts.length - withPhoto })
                : t("productsReady")
          }
          href="/products"
          highlight={activeProducts.length > 0 && withPhoto < activeProducts.length}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Setup */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">{t("setupTitle")}</h2>
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("setupProgress", { done: doneCount, total: steps.length })}
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }}
            />
          </div>
          <ul className="mt-4 divide-y divide-border">
            {steps.map((s) => (
              <li key={s.key}>
                <Link
                  href={s.href}
                  className="group flex items-center gap-3 py-3 text-sm transition-colors"
                >
                  {s.done ? (
                    <CheckCircle2 className="size-5 shrink-0 text-primary" />
                  ) : (
                    <Circle className="size-5 shrink-0 text-muted-foreground/60" />
                  )}
                  <span
                    className={cn(
                      "flex-1",
                      s.done ? "text-muted-foreground line-through decoration-muted-foreground/40" : "font-medium text-foreground",
                    )}
                  >
                    {t(s.key)}
                  </span>
                  {!s.done && (
                    <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      {t("start")}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Quick actions */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft lg:col-span-2">
          <h2 className="text-base font-semibold text-foreground">{t("quickActions")}</h2>
          <div className="mt-4 grid gap-2">
            <QuickAction href="/inbox" icon={MessageSquare} label={t("actionInbox")} />
            <QuickAction href="/products" icon={Package} label={t("actionProduct")} />
            <QuickAction href="/agents" icon={Bot} label={t("actionTest")} />
            <QuickAction href="/settings?tab=whatsapp" icon={PlugZap} label={t("actionWhatsapp")} />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  href,
  highlight,
}: {
  icon: typeof Bot;
  label: string;
  value: number;
  hint: string;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums text-foreground">
        {value.toLocaleString("en-US")}
      </p>
      <p className={cn("mt-2 text-xs", highlight ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
        {hint}
      </p>
    </Link>
  );
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: typeof Bot; label: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-border px-3.5 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary-soft"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-4" />
      </span>
      <span className="flex-1">{label}</span>
      <ArrowUpRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
    </Link>
  );
}
