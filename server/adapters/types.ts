import type { SourceId } from "../types.js";

/**
 * Source adapter — the boundary between the Agent and any one connected source. The agent
 * never talks to a source directly: Chat → Agent → tool registry → SourceAdapter → source.
 * `kind` records HOW this adapter actually reaches its source, purely for documentation/
 * `GET /api/tools` visibility — the Agent's own code never branches on it, so a real OAuth
 * integration can replace a mock adapter of either kind with no change to the Agent.
 *
 * - "mcp": backed by a real MCP client/server pair (Commas, Fathom, Zoom — see
 *   server/adapters/commasAdapter.ts, meetingsAdapter.ts).
 * - "api": backed by a direct API-shaped call, no MCP involved (Gmail, Google Calendar, CRM —
 *   see server/adapters/gmailAdapter.ts etc.) — these sources have no documented MCP surface,
 *   so forcing them through MCP would be inventing a capability that isn't established.
 */
export interface AdapterToolDef {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface AdapterToolResult {
  isError: boolean;
  data: unknown;
  rawText: string;
}

export interface SourceAdapter {
  sourceId: SourceId;
  kind: "mcp" | "api";
  listTools(): Promise<AdapterToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<AdapterToolResult>;
  close?(): Promise<void>;
}

export function jsonResult(payload: unknown): AdapterToolResult {
  const rawText = JSON.stringify(payload);
  return { isError: false, data: payload, rawText };
}

export function errorResult(message: string): AdapterToolResult {
  return { isError: true, data: message, rawText: message };
}
