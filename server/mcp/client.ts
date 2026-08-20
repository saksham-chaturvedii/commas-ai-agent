import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMockCommasServer } from "./mockCommasServer.js";

/**
 * MCP client wrapper — the Agent's only path to Commas data. Both connection modes speak the
 * real MCP protocol (JSON-RPC over the chosen transport); only the transport differs.
 *
 * - "mock" (default, `COMMAS_MCP_MODE=mock` or unset): connects in-process to
 *   mockCommasServer.ts over a real MCP `InMemoryTransport` linked pair. No secrets, safe for
 *   local dev — this is what the tool layer runs against today.
 * - "real" (`COMMAS_MCP_MODE=real`): connects over Streamable HTTP to `COMMAS_MCP_URL` with the
 *   `x-api-key` header commasdocs.com documents, using `COMMAS_API_KEY`. Wired but UNTESTED
 *   live — no Commas API key is available in this environment. Should only ever point at a QA
 *   sandbox, never production (docs/active-context.md § Risks).
 */

export interface McpToolResult {
  isError: boolean;
  /** Parsed JSON payload when the tool returned structured JSON text; raw text otherwise. */
  data: unknown;
  rawText: string;
}

export class McpConnectionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "McpConnectionError";
  }
}

export class McpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthError";
  }
}

export class CommasMcpClient {
  private client: Client;
  private connected = false;

  private constructor(client: Client) {
    this.client = client;
  }

  static async connectMock(): Promise<CommasMcpClient> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMockCommasServer();
    await server.connect(serverTransport);

    const client = new Client({ name: "commas-ai-agent", version: "0.1.0" });
    const wrapper = new CommasMcpClient(client);
    try {
      await client.connect(clientTransport);
    } catch (err) {
      throw new McpConnectionError("Failed to connect to the mock Commas MCP server.", err);
    }
    wrapper.connected = true;
    return wrapper;
  }

  /**
   * Real remote mode — Streamable HTTP against a live Commas MCP server. Never called by
   * default; only reachable via COMMAS_MCP_MODE=real with COMMAS_MCP_URL/COMMAS_API_KEY set.
   * Throws McpAuthError on 401/403, McpConnectionError on any other connection failure —
   * callers should not need to inspect the underlying transport.
   */
  static async connectReal(url: string, apiKey: string): Promise<CommasMcpClient> {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { "x-api-key": apiKey } },
    });
    const client = new Client({ name: "commas-ai-agent", version: "0.1.0" });
    const wrapper = new CommasMcpClient(client);
    try {
      await client.connect(transport);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/401|403|unauthor/i.test(message)) {
        throw new McpAuthError(`Commas MCP authentication failed: ${message}`);
      }
      throw new McpConnectionError(`Could not reach the Commas MCP server at ${url}.`, err);
    }
    wrapper.connected = true;
    return wrapper;
  }

  isConnected() {
    return this.connected;
  }

  async listTools() {
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
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
        // Not JSON — surface as malformed by leaving `data` as the raw string; the agent
        // runtime's classifyError()/consumer decides whether that's acceptable for this tool.
      }
    }
    return { isError, data, rawText };
  }

  async close() {
    await this.client.close();
    this.connected = false;
  }
}
