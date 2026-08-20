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
    progressLabel: "Checking the CRM record…",
    displayName: "CRM contact",
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
