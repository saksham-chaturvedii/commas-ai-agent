import { useState } from "react";
import { ChevronDown, ChevronRight, Check } from "lucide-react";
import type { ToolSummaryItem } from "../../lib/types";
import { SourceIcon } from "./SourceIcon";

/** Collapsed "Checked N sources" line under a finished answer; expands to per-item detail.
 * `defaultOpen` starts it expanded — used for a full investigation's message, where the step
 * checklist ("Reviewed dispute details", "Found completed coaching calls", …) is the point,
 * not a detail to dig for. */
export function ToolSummary({ items, defaultOpen = false }: { items: ToolSummaryItem[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-quaternary)] hover:text-[var(--color-text-label)]"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Checked {items.length} {items.length === 1 ? "source" : "sources"}
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1 pl-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-[12px] text-[var(--color-text-quaternary)]">
              <Check size={12} className="text-[var(--color-success-text)]" />
              <SourceIcon sourceId={item.sourceId} size={12} />
              {item.resultLabel ?? item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
