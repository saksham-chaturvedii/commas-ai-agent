// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CommasAdapter } from "../../server/adapters/commasAdapter.js";
import { createFathomAdapter, createZoomAdapter } from "../../server/adapters/meetingsAdapters.js";
import { GmailAdapter } from "../../server/adapters/gmailAdapter.js";
import { CalendarAdapter } from "../../server/adapters/calendarAdapter.js";
import { CrmAdapter } from "../../server/adapters/crmAdapter.js";
import type { SourceAdapter } from "../../server/adapters/types.js";
import { buildToolRegistry } from "../../server/agent/registry.js";
import { sharedAgentToolsFor, SHARED_AGENT_TOOL_SOURCES } from "../../server/agent/tools/index.js";

/**
 * The shared agent's tool-scoping decision (docs/AI_ASSISTANT_ARCHITECTURE.md §6) — read tools
 * only, from every source (audit P1-2 widened this from Commas-only, which meant the global
 * chat's own "connected apps" suggestion chip always failed on the real route). All 6 source
 * adapters (matching server/app.ts's real construction) are wired up here so these tests prove
 * the SCOPING itself, not an artifact of only Commas being available to filter from.
 */
async function allAdapters(): Promise<SourceAdapter[]> {
  return [
    await CommasAdapter.createMock(),
    await createFathomAdapter(),
    await createZoomAdapter(),
    new GmailAdapter(),
    new CalendarAdapter(),
    new CrmAdapter(),
  ];
}

describe("sharedAgentToolsFor", () => {
  it("exposes read tools from every source, when every source is enabled and connected", async () => {
    const adapters = await allAdapters();
    const registry = await buildToolRegistry(adapters);

    const tools = sharedAgentToolsFor(
      ["commas", "google-calendar", "zoom", "fathom", "gmail", "crm"],
      registry,
    );

    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "commas_get_dispute",
        "commas_list_disputes",
        "fanbasis_get_transaction",
        "fanbasis_list_customers",
        "fanbasis_list_transactions",
        "calendar_list_events",
        "zoom_list_meetings",
        "fathom_search_calls",
        "gmail_search_threads",
        "crm_get_contact",
      ].sort(),
    );
  });

  it("never includes the one Commas write tool, even when Commas is enabled", async () => {
    const adapters = await allAdapters();
    const registry = await buildToolRegistry(adapters);
    const tools = sharedAgentToolsFor(["commas"], registry);
    expect(tools.some((t) => t.name === "commas_mark_dispute_response_ready")).toBe(false);
  });

  it("respects this specific chat's enabled sources — a source's tools disappear if the chat has it turned off", async () => {
    const adapters = await allAdapters();
    const registry = await buildToolRegistry(adapters);
    const tools = sharedAgentToolsFor(["google-calendar", "zoom", "fathom"], registry); // commas NOT enabled
    expect(tools.some((t) => t.name.startsWith("commas_") || t.name.startsWith("fanbasis_"))).toBe(false);
    expect(tools.map((t) => t.name).sort()).toEqual(["calendar_list_events", "fathom_search_calls", "zoom_list_meetings"].sort());
  });

  it("SHARED_AGENT_TOOL_SOURCES includes every simulated connector, not just Commas", () => {
    expect([...SHARED_AGENT_TOOL_SOURCES].sort()).toEqual(["commas", "crm", "fathom", "gmail", "google-calendar", "zoom"].sort());
  });
});
