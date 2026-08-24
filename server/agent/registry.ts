import type { SourceAdapter } from "../adapters/types.js";
import type { SourceId, ToolClassification } from "../types.js";

/**
 * The tool registry — built by asking every connected SourceAdapter what it exposes
 * (`adapter.listTools()`), not hardcoded. This is what "tool discovery" means here: the
 * agent (and GET /api/tools) always reflects whatever the connected sources actually expose.
 * `KNOWN_TOOLS` only supplies presentation metadata (a safe progress label, which
 * classification) for tools this prototype knows about — any tool a source exposes that
 * ISN'T in this map still gets registered, just with a generic label and a fail-safe "write"
 * classification (never assume an unrecognized tool is safe to auto-run).
 */

export interface RegisteredTool {
  name: string;
  sourceId: SourceId;
  classification: ToolClassification;
  progressLabel: string;
  displayName: string;
  description?: string;
  inputSchema: unknown;
}

const KNOWN_TOOLS: Record<string, { classification: ToolClassification; progressLabel: string; displayName: string }> = {
  fanbasis_list_customers: {
    classification: "read",
    progressLabel: "Checking customer records…",
    displayName: "Customer records",
  },
  fanbasis_list_transactions: {
    classification: "read",
    progressLabel: "Checking transaction history…",
    displayName: "Transaction history",
  },
  fanbasis_get_transaction: {
    classification: "read",
    progressLabel: "Checking transaction details…",
    displayName: "Transaction details",
  },
  commas_get_dispute: {
    classification: "read",
    progressLabel: "Checking dispute record…",
    displayName: "Dispute record",
  },
  commas_list_disputes: {
    classification: "read",
    progressLabel: "Checking your disputes…",
    displayName: "Disputes",
  },
  commas_mark_dispute_response_ready: {
    classification: "write",
    progressLabel: "Marking the response ready…",
    displayName: "Mark response ready",
  },
  fathom_search_calls: {
    classification: "read",
    progressLabel: "Searching Fathom calls…",
    displayName: "Fathom calls",
  },
  zoom_list_meetings: {
    classification: "read",
    progressLabel: "Checking Zoom meeting history…",
    displayName: "Zoom meetings",
  },
  gmail_search_threads: {
    classification: "read",
    progressLabel: "Checking Gmail threads…",
    displayName: "Gmail threads",
  },
  calendar_list_events: {
    classification: "read",
    progressLabel: "Checking Google Calendar…",
    displayName: "Calendar events",
  },
  crm_get_contact: {
    classification: "read",
    progressLabel: "Checking GoHighLevel…",
    displayName: "GoHighLevel contact",
  },
};

/**
 * Pure classification decision for one tool name — extracted so the fail-safe "unrecognized
 * tool defaults to write" behavior is directly unit-testable without needing a live source
 * that actually exposes an unknown tool (tests/server/registry.test.ts).
 */
export function classifyToolName(name: string) {
  const known = KNOWN_TOOLS[name];
  return {
    classification: known?.classification ?? ("write" as ToolClassification),
    progressLabel: known?.progressLabel ?? `Running ${name}…`,
    displayName: known?.displayName ?? name,
  };
}

/**
 * The completed-step label shown once a read tool's result is actually in hand (the checkmark
 * state of ProgressBlock.tsx / ToolSummary.tsx) — past-tense and, where it matters, aware of
 * WHAT was actually found, not just a static rephrasing of `progressLabel`'s in-flight gerund.
 * "Do not fake completed steps" (docs/AI_ASSISTANT_IMPLEMENTATION_STATUS.md's current phase):
 * every branch below reads the real `data` shape a tool actually returned — a source that came
 * back empty says so, never "Found X" it didn't find. A failed call always gets its own
 * "Couldn't check…" label regardless of tool, since there's nothing in `data` to describe.
 */
export function resultLabelFor(toolName: string, ok: boolean, data: unknown): string {
  const known = KNOWN_TOOLS[toolName];
  const displayName = known?.displayName ?? toolName;
  if (!ok) return `Couldn't check ${displayName}`;

  const d = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const count = (key: string) => (Array.isArray(d[key]) ? (d[key] as unknown[]).length : 0);

  switch (toolName) {
    case "commas_get_dispute":
      return "Reviewed dispute details";
    case "commas_list_disputes":
      return "Reviewed your disputes";
    case "fanbasis_list_customers":
      return count("customers") > 0 ? "Found matching customer records" : "No matching customers found";
    case "fanbasis_list_transactions":
      return count("transactions") > 0 ? "Checked transaction history" : "No transactions found";
    case "fanbasis_get_transaction":
      return d.transaction ? "Checked transaction details" : "Transaction not found";
    case "crm_get_contact":
      return d.contact ? "Found GoHighLevel account history" : "No GoHighLevel contact on file";
    case "gmail_search_threads":
      return count("threads") > 0 ? "Reviewed connected communications" : "No email threads found";
    case "fathom_search_calls":
      return count("calls") > 0 ? "Found completed coaching calls" : "No recorded calls found";
    case "zoom_list_meetings":
      return count("meetings") > 0 ? "Confirmed meeting attendance" : "No Zoom meetings found";
    case "calendar_list_events":
      return count("events") > 0 ? "Found scheduled coaching calls" : "No scheduled events found";
    default:
      return `Checked ${displayName}`;
  }
}

export async function buildToolRegistry(adapters: SourceAdapter[]): Promise<Map<string, RegisteredTool>> {
  const registry = new Map<string, RegisteredTool>();

  for (const adapter of adapters) {
    const tools = await adapter.listTools();
    for (const tool of tools) {
      const meta = classifyToolName(tool.name);
      registry.set(tool.name, {
        name: tool.name,
        sourceId: adapter.sourceId,
        ...meta,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
  }

  return registry;
}

export function listAvailableTools(registry: Map<string, RegisteredTool>) {
  return Array.from(registry.values()).map((t) => ({
    name: t.name,
    sourceId: t.sourceId,
    classification: t.classification,
    displayName: t.displayName,
    description: t.description,
  }));
}
