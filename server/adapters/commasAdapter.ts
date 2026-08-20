import { CommasMcpClient } from "../mcp/client.js";
import type { AdapterToolDef, SourceAdapter } from "./types.js";

/** MCP-backed adapter — thin wrapper around the already-tested CommasMcpClient. */
export class CommasAdapter implements SourceAdapter {
  readonly sourceId = "commas" as const;
  readonly kind = "mcp" as const;

  private constructor(private client: CommasMcpClient) {}

  static async createMock(): Promise<CommasAdapter> {
    return new CommasAdapter(await CommasMcpClient.connectMock());
  }

  static async createReal(url: string, apiKey: string): Promise<CommasAdapter> {
    return new CommasAdapter(await CommasMcpClient.connectReal(url, apiKey));
  }

  async listTools(): Promise<AdapterToolDef[]> {
    const tools = await this.client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return this.client.callTool(name, args);
  }

  async close() {
    await this.client.close();
  }
}
