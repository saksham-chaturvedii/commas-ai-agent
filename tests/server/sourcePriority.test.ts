// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sourcePriorityFor } from "../../server/llm/stubClient.js";

/**
 * Direct unit coverage of the reason-code → source-priority mapping (server/llm/stubClient.ts's
 * REASON_SOURCE_PRIORITY). "fraudulent" has no dispute case in the fixed demo roster
 * (src/lib/disputeData.ts deliberately stays at 4 open disputes), so this is the only place its
 * mapping is exercised.
 */
describe("sourcePriorityFor", () => {
  it("prioritizes account/transaction history (GoHighLevel) for a fraudulent dispute", () => {
    expect(sourcePriorityFor("fraudulent")).toEqual(["crm_get_contact"]);
  });

  it("prioritizes activity/fulfillment evidence and communications for product_not_received, skipping GoHighLevel", () => {
    const priority = sourcePriorityFor("product_not_received");
    expect(priority).toEqual(["fathom_search_calls", "zoom_list_meetings", "gmail_search_threads"]);
    expect(priority).not.toContain("crm_get_contact");
  });

  it("prioritizes Calendar, Zoom, Fathom, and communications for product_unacceptable", () => {
    expect(sourcePriorityFor("product_unacceptable")).toEqual([
      "calendar_list_events",
      "zoom_list_meetings",
      "fathom_search_calls",
      "gmail_search_threads",
    ]);
  });

  it("prioritizes communications only for a duplicate-charge dispute", () => {
    expect(sourcePriorityFor("duplicate")).toEqual(["gmail_search_threads"]);
  });

  it("falls back to the full, exhaustive default for an unrecognized or missing reason code", () => {
    expect(sourcePriorityFor(undefined)).toEqual([
      "crm_get_contact",
      "gmail_search_threads",
      "fathom_search_calls",
      "zoom_list_meetings",
      "calendar_list_events",
    ]);
    expect(sourcePriorityFor("some_unmapped_reason")).toEqual(sourcePriorityFor(undefined));
  });
});
