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
 * The shared agent's tool-scoping decision (docs/AI_ASSISTANT_ARCHITECTURE.md §6) — this phase's
 * explicit, temporary policy: Commas only, read tools only. All 6 source adapters (matching
 * server/app.ts's real construction) are wired up here so these tests prove the SCOPING itself,
 * not an artifact of only Commas being available to filter from.
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
  it("exposes only Commas's read tools, even when every source is enabled and connected", async () => {
    const adapters = await allAdapters();
    const registry = await buildToolRegistry(adapters);

    const tools = sharedAgentToolsFor(
      ["commas", "google-calendar", "zoom", "fathom", "gmail", "crm"],
      registry,
    );

    expect(tools.map((t) => t.name).sort()).toEqual(
      ["commas_get_dispute", "commas_list_disputes", "fanbasis_get_transaction", "fanbasis_list_customers", "fanbasis_list_transactions"].sort(),
    );
  });

  it("never includes the one Commas write tool, even when Commas is enabled", async () => {
    const adapters = await allAdapters();
    const registry = await buildToolRegistry(adapters);
    const tools = sharedAgentToolsFor(["commas"], registry);
    expect(tools.some((t) => t.name === "commas_mark_dispute_response_ready")).toBe(false);
  });

  it("never includes Fathom/Zoom/Gmail/Calendar/GoHighLevel tools, even when explicitly enabled — 'do not implement OAuth connectors yet'", async () => {
    const adapters = await allAdapters();
    const registry = await buildToolRegistry(adapters);
    const tools = sharedAgentToolsFor(["fathom", "zoom", "gmail", "google-calendar", "crm"], registry);
    expect(tools).toEqual([]);
  });

  it("respects this specific chat's enabled sources — Commas tools disappear if the chat has Commas turned off", async () => {
    const adapters = await allAdapters();
    const registry = await buildToolRegistry(adapters);
    const tools = sharedAgentToolsFor(["google-calendar", "zoom", "fathom"], registry); // commas NOT enabled
    expect(tools).toEqual([]);
  });

  it("SHARED_AGENT_TOOL_SOURCES documents exactly the Commas-only scope this phase — widening it is the whole change needed to add a source later", () => {
    expect(SHARED_AGENT_TOOL_SOURCES).toEqual(["commas"]);
  });
});
