// @vitest-environment node
import { describe, expect, it, afterEach } from "vitest";
import { CommasAdapter } from "../../server/adapters/commasAdapter.js";
import { createFathomAdapter, createZoomAdapter } from "../../server/adapters/meetingsAdapters.js";
import { GmailAdapter } from "../../server/adapters/gmailAdapter.js";
import { CalendarAdapter } from "../../server/adapters/calendarAdapter.js";
import { CrmAdapter } from "../../server/adapters/crmAdapter.js";
import type { SourceAdapter } from "../../server/adapters/types.js";
import { buildToolRegistry, classifyToolName, listAvailableTools } from "../../server/agent/registry.js";

describe("classifyToolName", () => {
  it("classifies known read tools as read", () => {
    for (const name of [
      "fanbasis_list_customers",
      "fanbasis_list_transactions",
      "fanbasis_get_transaction",
      "commas_get_dispute",
      "fathom_search_calls",
      "zoom_list_meetings",
      "gmail_search_threads",
      "calendar_list_events",
      "crm_get_contact",
    ]) {
      expect(classifyToolName(name).classification).toBe("read");
    }
  });

  it("classifies the mark-response-ready tool as write — it must always pause for approval", () => {
    expect(classifyToolName("commas_mark_dispute_response_ready").classification).toBe("write");
  });

  it("fails safe: an unrecognized tool name defaults to write, never auto-runnable as read", () => {
    expect(classifyToolName("some_tool_nobody_registered").classification).toBe("write");
  });
});

describe("buildToolRegistry (tool discovery across all adapters)", () => {
  let adapters: SourceAdapter[];
  afterEach(async () => {
    await Promise.all(adapters?.map((a) => a.close?.()) ?? []);
  });

  it("discovers tools from every connected adapter — not from a hardcoded UI list", async () => {
    adapters = [
      await CommasAdapter.createMock(),
      await createFathomAdapter(),
      await createZoomAdapter(),
      new GmailAdapter(),
      new CalendarAdapter(),
      new CrmAdapter(),
    ];
    const registry = await buildToolRegistry(adapters);

    expect(new Set(registry.keys())).toEqual(
      new Set([
        "fanbasis_list_customers",
        "fanbasis_list_transactions",
        "fanbasis_get_transaction",
        "commas_get_dispute",
        "commas_list_disputes",
        "commas_mark_dispute_response_ready",
        "fathom_search_calls",
        "zoom_list_meetings",
        "gmail_search_threads",
        "calendar_list_events",
        "crm_get_contact",
      ]),
    );

    // each tool is tagged with the sourceId of the adapter that actually exposed it
    expect(registry.get("fathom_search_calls")?.sourceId).toBe("fathom");
    expect(registry.get("zoom_list_meetings")?.sourceId).toBe("zoom");
    expect(registry.get("gmail_search_threads")?.sourceId).toBe("gmail");
    expect(registry.get("calendar_list_events")?.sourceId).toBe("google-calendar");
    expect(registry.get("crm_get_contact")?.sourceId).toBe("crm");
    expect(registry.get("commas_get_dispute")?.sourceId).toBe("commas");

    const listed = listAvailableTools(registry);
    expect(listed.filter((t) => t.classification === "write")).toHaveLength(1);
  });
});
