import type { ReactNode } from "react";

/**
 * Minimal renderer for the mock engine's canned answers: **bold** spans and blank-line
 * paragraph breaks. Not a general markdown parser — deliberately tiny for this UI-only pass.
 */
export function renderLiteMarkdown(text: string): ReactNode {
  const paragraphs = text.split(/\n\n+/);
  return (
    <>
      {paragraphs.map((para, pi) => (
        <p key={pi} className={pi > 0 ? "mt-2.5" : undefined}>
          {renderInline(para)}
        </p>
      ))}
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
