import type { ReactNode } from "react";

/**
 * Minimal renderer for the mock engine's canned answers: **bold** spans, blank-line-separated
 * blocks, `### Heading` blocks, and `- item` bullet lists. Not a general markdown parser —
 * deliberately tiny for this UI-only pass, extended just enough to render the flagship dispute
 * investigation's structured output (case summary / timeline / evidence / draft).
 */
export function renderLiteMarkdown(text: string): ReactNode {
  const blocks = text.split(/\n\n+/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.length > 0);
        const spacing = bi > 0 ? "mt-2.5" : undefined;

        if (lines.length === 1 && lines[0].startsWith("### ")) {
          return (
            <h4
              key={bi}
              className={
                "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-quaternary)]" +
                (bi > 0 ? " mt-3" : "")
              }
            >
              {renderInline(lines[0].slice(4))}
            </h4>
          );
        }

        if (lines.length > 0 && lines.every((l) => l.trim().startsWith("- "))) {
          return (
            <ul key={bi} className={"list-disc pl-5 flex flex-col gap-1" + (bi > 0 ? " mt-2" : "")}>
              {lines.map((line, li) => (
                <li key={li}>{renderInline(line.trim().slice(2))}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={bi} className={spacing}>
            {renderInline(block)}
          </p>
        );
      })}
    </>
  );
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}
