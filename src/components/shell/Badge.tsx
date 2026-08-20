import type { ReactNode } from "react";

type Variant = "warning" | "success" | "danger" | "neutral" | "info";

const VARIANTS: Record<Variant, { bg: string; text: string; border?: string }> = {
  warning: { bg: "#ffefdf", text: "#cb6301", border: "#f6ba94" },
  success: { bg: "#edfcde", text: "#366f08", border: "#b5ef72" },
  danger: { bg: "#fdecee", text: "#d5384b" },
  neutral: { bg: "#fafafa", text: "#6b7280", border: "#ebebeb" },
  info: { bg: "#edf3ff", text: "#4f7fcd", border: "#aed3fa" },
};

/** Ported verbatim from commas-ai-copilot. */
export function Badge({ variant, children }: { variant: Variant; children: ReactNode }) {
  const c = VARIANTS[variant];
  return (
    <span
      className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap"
      style={{
        background: c.bg,
        color: c.text,
        border: c.border ? `1px solid ${c.border}` : undefined,
      }}
    >
      {children}
    </span>
  );
}
