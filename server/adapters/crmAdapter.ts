import type { AdapterToolDef, SourceAdapter } from "./types.js";
import { jsonResult } from "./types.js";

/** API-style adapter — PROTOTYPE DATA ONLY, no real CRM/OAuth involved, deliberately
 * vendor-neutral (Commas' CPO named this as "your CRM", not a specific product). */

interface MockContact {
  email: string;
  name: string;
  status: "active_client" | "lead" | "past_client";
  lifetimeValueCents: number;
  notes: string;
}

const CONTACTS: MockContact[] = [
  {
    email: "sarah.johnson@email.com",
    name: "Sarah Johnson",
    status: "active_client",
    lifetimeValueCents: 49900,
    notes: "Enrolled in Pro Coaching Program Aug 2026. Engaged, attended live sessions.",
  },
];

export class CrmAdapter implements SourceAdapter {
  readonly sourceId = "crm" as const;
  readonly kind = "api" as const;

  async listTools(): Promise<AdapterToolDef[]> {
    return [
      {
        name: "crm_get_contact",
        description: "Look up a CRM contact record by email.",
        inputSchema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
      },
    ];
  }

  async callTool(name: string, args: Record<string, unknown>) {
    if (name !== "crm_get_contact") return { isError: true, data: `Unknown tool: ${name}`, rawText: `Unknown tool: ${name}` };
    const email = typeof args.email === "string" ? args.email.toLowerCase() : undefined;
    const contact = CONTACTS.find((c) => c.email.toLowerCase() === email);
    if (!contact) return { isError: true, data: `No CRM contact found for ${email}`, rawText: `No CRM contact found for ${email}` };
    return jsonResult({ contact });
  }
}
