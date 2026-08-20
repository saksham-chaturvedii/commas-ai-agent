import type { CommasMcpClient } from "../mcp/client.js";
import type { SourceId, ToolClassification } from "../types.js";

/**
 * The tool registry — built from the MCP server's `tools/list` response, not hardcoded. This
 * is what "tool discovery" means here: the agent (and GET /api/tools) always reflects whatever
 * the connected MCP server actually exposes. `KNOWN_TOOLS` only supplies presentation metadata
 * (a safe progress label, which source it belongs to) for the tools this prototype knows about
 * — any tool the server exposes that ISN'T in this map still gets registered, just with a
 * generic label and a fail-safe "write" classification (ARCHITECTURE.md §8: never assume an
 * unrecognized tool is safe to auto-run).
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
};

/**
 * Pure classification decision for one tool name — extracted so the fail-safe "unrecognized
 * tool defaults to write" behavior is directly unit-testable without needing an MCP server
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

export async function buildToolRegistry(mcpClient: CommasMcpClient): Promise<Map<string, RegisteredTool>> {
  const tools = await mcpClient.listTools();
  const registry = new Map<string, RegisteredTool>();

  for (const tool of tools) {
    const meta = classifyToolName(tool.name);
    registry.set(tool.name, {
      name: tool.name,
      sourceId: "commas",
      ...meta,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
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
