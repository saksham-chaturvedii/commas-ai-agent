import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderLiteMarkdown } from "../src/lib/liteMarkdown";

describe("renderLiteMarkdown", () => {
  it("renders a plain paragraph with bold spans", () => {
    render(<div>{renderLiteMarkdown("Hello **world**")}</div>);
    const strong = screen.getByText("world");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders a ### heading block as an h4", () => {
    render(<div>{renderLiteMarkdown("### Case summary\n\nSome text here.")}</div>);
    expect(screen.getByText("Case summary").closest("h4")).not.toBeNull();
    expect(screen.getByText("Some text here.").closest("p")).not.toBeNull();
  });

  it("renders consecutive - lines as a single bulleted list", () => {
    render(<div>{renderLiteMarkdown("### Timeline\n\n- First item\n- Second item")}</div>);
    const list = screen.getByText("First item").closest("ul");
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders the full flagship-style structure (heading, list, heading, paragraph)", () => {
    const text = [
      "### Case summary",
      "**Dispute #2481** happened.",
      "### Timeline",
      "- Step one\n- Step two",
      "### Drafted response",
      "\"Draft text.\"",
    ].join("\n\n");
    render(<div>{renderLiteMarkdown(text)}</div>);
    expect(screen.getByText("Case summary").closest("h4")).not.toBeNull();
    expect(screen.getByText("Timeline").closest("h4")).not.toBeNull();
    expect(screen.getByText("Drafted response").closest("h4")).not.toBeNull();
    const list = screen.getByText("Step one").closest("ul");
    expect(list?.querySelectorAll("li")).toHaveLength(2);
  });
});
