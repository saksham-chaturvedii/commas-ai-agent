import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Connects a real MCP `Client` to an in-process `McpServer` over a real (in-memory) MCP
 * transport — the same pattern server/mcp/client.ts uses for Commas, generalized so the
 * Fathom/Zoom mock servers can reuse it without duplicating the wiring. */
export async function connectInProcess(server: McpServer, clientName: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: clientName, version: "0.1.0" });
  await client.connect(clientTransport);
  return client;
}
