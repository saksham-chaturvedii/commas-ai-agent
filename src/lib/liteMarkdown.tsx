import type { ReactNode } from "react";

/**
 * Minimal renderer for the stub agent's answers: **bold** spans, `### Heading` lines, and
 * `- item` bullet lists. Not a general markdown parser — deliberately tiny.
 *
 * Segments the text LINE-WISE rather than by blank-line blocks: a `### ` heading or a `- `
 * list run is recognized wherever it appears, whether separated by `\n` or `\n\n`. The old
 * block-only version silently rendered `### Situation summary` as literal paragraph text
 * whenever an answer joined its lines with single newlines (PRODUCT_READINESS_AUDIT.md P0-1)
 * — segmenting by line shape makes the renderer robust to either join style.
 */

type Segment = { kind: "heading"; text: string } | { kind: "list"; items: string[] } | { kind: "para"; text: string };

function segment(text: string): Segment[] {
  const segments: Segment[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      segments.push({ kind: "para", text: para.join(" ") });
      para = [];
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flushPara();
    } else if (line.startsWith("### ")) {
      flushPara();
      segments.push({ kind: "heading", text: line.slice(4) });
    } else if (line.startsWith("- ")) {
      flushPara();
      const last = segments[segments.length - 1];
      if (last?.kind === "list") last.items.push(line.slice(2));
      else segments.push({ kind: "list", items: [line.slice(2)] });
    } else {
      para.push(line);
    }
  }
  flushPara();
  return segments;
}

export function renderLiteMarkdown(text: string): ReactNode {
  const segments = segment(text);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "heading") {
          return (
            <h4
              key={i}
              className={
                "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-quaternary)]" +
                (i > 0 ? " mt-3" : "")
              }
            >
              {renderInline(seg.text)}
            </h4>
          );
        }
        if (seg.kind === "list") {
          return (
            <ul key={i} className={"list-disc pl-5 flex flex-col gap-1" + (i > 0 ? " mt-2" : "")}>
              {seg.items.map((item, li) => (
                <li key={li}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className={i > 0 ? "mt-2.5" : undefined}>
            {renderInline(seg.text)}
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
