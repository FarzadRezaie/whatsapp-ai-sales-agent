import { getLocale, getTranslations } from "next-intl/server";
import { Clock3, ImageIcon, MessageSquareText } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { brandName } from "@/lib/brand";
import { LanguageToggle } from "@/components/layout/language-toggle";

/**
 * Sign-in / sign-up frame: a brand panel (desktop) beside the form.
 * Server component so the brand copy is in the first paint.
 */
export async function AuthShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("AuthShell");
  const name = brandName(await getLocale());

  const points = [
    { icon: MessageSquareText, text: t("point1") },
    { icon: ImageIcon, text: t("point2") },
    { icon: Clock3, text: t("point3") },
  ];

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Soft decorative light — no images, stays crisp in both modes. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -end-32 -top-32 size-[28rem] rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -start-24 size-[26rem] rounded-full bg-black/10 blur-3xl"
        />

        <div className="relative">
          <span className="inline-flex items-center gap-2.5">
            <LogoMark className="size-10 bg-white/15 ring-1 ring-white/25" />
            <span className="text-lg font-semibold tracking-tight">{name}</span>
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
            {t("headline")}
          </h2>
          <p className="mt-4 text-base text-primary-foreground/80">{t("subline")}</p>
          <ul className="mt-10 space-y-4">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                <span className="text-sm leading-relaxed text-primary-foreground/90">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} {name}
        </p>
      </aside>

      <main className="relative flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <LanguageToggle className="absolute end-4 top-4 sm:end-6 sm:top-6" />
        <div className="mb-8 lg:hidden">
          <Logo name={name} />
        </div>
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
