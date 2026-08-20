import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { AdapterToolDef, AdapterToolResult, SourceAdapter } from "./types.js";
import type { SourceId } from "../types.js";

/** Generic MCP-backed SourceAdapter — connects any one source to the agent via a real MCP
 * client. Used for Fathom and Zoom (server/mcp/mockFathomServer.ts,
 * server/mcp/mockZoomServer.ts); Commas has its own richer CommasAdapter but follows the same
 * shape. */
export class McpSourceAdapter implements SourceAdapter {
  readonly kind = "mcp" as const;

  constructor(
    readonly sourceId: SourceId,
    private client: Client,
  ) {}

  async listTools(): Promise<AdapterToolDef[]> {
    const result = await this.client.listTools();
    return result.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<AdapterToolResult> {
    const result = await this.client.callTool({ name, arguments: args });
    const isError = "isError" in result && result.isError === true;
    const content = "content" in result ? result.content : undefined;
    const firstText = Array.isArray(content)
      ? content.find((c): c is { type: "text"; text: string } => c.type === "text")
      : undefined;
    const rawText = firstText?.text ?? "";

    let data: unknown = rawText;
    if (!isError && rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        // leave data as the raw string — malformed, not our job to fix here
      }
    }
    return { isError, data, rawText };
  }

  async close() {
    await this.client.close();
  }
}
