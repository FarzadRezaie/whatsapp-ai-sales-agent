import { cn } from "@/lib/utils";

/**
 * Brand mark: a speech bubble with a small sparkle — "the shop's
 * assistant that answers chats". Pure SVG so it stays crisp at any size
 * and follows the theme colours.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft",
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[60%]">
        <path
          d="M4.5 11.2c0-3.7 3.36-6.7 7.5-6.7s7.5 3 7.5 6.7-3.36 6.7-7.5 6.7c-.86 0-1.69-.13-2.46-.37L5.7 19l.86-3.05A6.4 6.4 0 0 1 4.5 11.2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M12 8.2l.75 1.9 1.95.75-1.95.75L12 13.5l-.75-1.9-1.95-.75 1.95-.75L12 8.2Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

export function Logo({
  name,
  className,
  markClassName,
}: {
  name: string;
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">{name}</span>
    </span>
  );
}
