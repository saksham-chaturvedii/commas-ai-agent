import type { AdapterToolDef, SourceAdapter } from "./types.js";
import { jsonResult } from "./types.js";

/** API-style adapter for GoHighLevel (GHL) — PROTOTYPE DATA ONLY, no real GoHighLevel
 * account or OAuth involved. The internal sourceId stays "crm" (renaming the id would ripple
 * through persisted chats, tests, and the registry for zero user-visible benefit); every
 * user-facing string says GoHighLevel.
 *
 * `pipelineStage` and `activityLog` are the "pipeline/activity records" and "communication
 * records" a real CRM/pipeline tool would expose, beyond a flat contact record — e.g. account
 * history for a fraud-style investigation (was this a long-standing, engaged contact, or a
 * brand-new one with no pipeline history at all?). Not every customer has a contact record
 * here — Elena and David don't, matching this prototype's data honestly rather than inventing
 * a record for every case regardless of whether one would realistically exist.
 */

interface MockActivityEntry {
  date: string;
  type: "pipeline_stage_change" | "call_booked" | "note";
  detail: string;
}

interface MockContact {
  email: string;
  name: string;
  status: "active_client" | "lead" | "past_client";
  pipelineStage: "prospect" | "customer" | "churned";
  lifetimeValueCents: number;
  notes: string;
  activityLog: MockActivityEntry[];
}

const CONTACTS: MockContact[] = [
  {
    email: "sarah.johnson@email.com",
    name: "Sarah Johnson",
    status: "active_client",
    pipelineStage: "customer",
    lifetimeValueCents: 49900,
    notes: "Enrolled in Pro Coaching Program Aug 2026. Engaged, attended live sessions.",
    activityLog: [
      { date: "2026-08-02T14:00:00Z", type: "pipeline_stage_change", detail: "Moved to Customer after purchasing Pro Coaching Program." },
      { date: "2026-08-04T15:00:00Z", type: "call_booked", detail: "Booked onboarding call." },
    ],
  },
  {
    email: "marcus.webb@email.com",
    name: "Marcus Webb",
    status: "active_client",
    pipelineStage: "customer",
    lifetimeValueCents: 12900,
    notes: "Purchased 1:1 Strategy Call Aug 2026. No prior pipeline history before this purchase.",
    activityLog: [
      { date: "2026-08-12T09:10:00Z", type: "pipeline_stage_change", detail: "Moved to Customer after purchasing 1:1 Strategy Call." },
      { date: "2026-08-13T18:00:00Z", type: "call_booked", detail: "Booked 1:1 Strategy Call." },
    ],
  },
  {
    email: "priya.nair@email.com",
    name: "Priya Nair",
    status: "active_client",
    pipelineStage: "customer",
    lifetimeValueCents: 34900,
    notes: "Enrolled in Pro Coaching Program Jul 2026. Long-standing engaged contact.",
    activityLog: [
      { date: "2026-07-30T10:22:00Z", type: "pipeline_stage_change", detail: "Moved to Customer after purchasing Pro Coaching Program." },
      { date: "2026-08-03T00:00:00Z", type: "note", detail: "Filed a product-not-received dispute despite active portal engagement." },
    ],
  },
];

export class CrmAdapter implements SourceAdapter {
  readonly sourceId = "crm" as const;
  readonly kind = "api" as const;

  async listTools(): Promise<AdapterToolDef[]> {
    return [
      {
        name: "crm_get_contact",
        description: "Look up a GoHighLevel contact record by email.",
        inputSchema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
      },
    ];
  }

  async callTool(name: string, args: Record<string, unknown>) {
    if (name !== "crm_get_contact") return { isError: true, data: `Unknown tool: ${name}`, rawText: `Unknown tool: ${name}` };
    const email = typeof args.email === "string" ? args.email.toLowerCase() : undefined;
    const contact = CONTACTS.find((c) => c.email.toLowerCase() === email);
    // A missing contact is a normal empty result, not a connector failure — returning isError
    // here made the UI imply GoHighLevel itself was broken (audit §11.2).
    return jsonResult({ contact: contact ?? null });
  }
}
