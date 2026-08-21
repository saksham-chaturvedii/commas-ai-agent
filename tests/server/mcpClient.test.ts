// @vitest-environment node
import { describe, expect, it, afterEach } from "vitest";
import { CommasMcpClient, McpConnectionError } from "../../server/mcp/client.js";

describe("CommasMcpClient — mock mode (real MCP protocol, in-process transport)", () => {
  let client: CommasMcpClient;
  afterEach(async () => {
    await client?.close();
  });

  it("lists the tools the mock Commas MCP server exposes", async () => {
    client = await CommasMcpClient.connectMock();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "commas_get_dispute",
        "commas_list_disputes",
        "commas_mark_dispute_response_ready",
        "fanbasis_get_transaction",
        "fanbasis_list_customers",
        "fanbasis_list_transactions",
      ].sort(),
    );
  });

  it("round-trips a successful customer lookup as parsed JSON", async () => {
    client = await CommasMcpClient.connectMock();
    const result = await client.callTool("fanbasis_list_customers", { search: "sarah" });
    expect(result.isError).toBe(false);
    expect(result.data).toEqual({ customers: [{ id: "cus_sarahjohnson", name: "Sarah Johnson", email: "sarah.johnson@email.com" }] });
  });

  it("returns an empty (non-error) result for a search matching nobody", async () => {
    client = await CommasMcpClient.connectMock();
    const result = await client.callTool("fanbasis_list_customers", { search: "nobody-matches-this" });
    expect(result.isError).toBe(false);
    expect(result.data).toEqual({ customers: [] });
  });

  it("surfaces an unknown transaction id as a tool-level error, not a thrown exception", async () => {
    client = await CommasMcpClient.connectMock();
    const result = await client.callTool("fanbasis_get_transaction", { id: "txn_doesnotexist" });
    expect(result.isError).toBe(true);
    expect(result.rawText).toContain("txn_doesnotexist");
  });

  it("looks up the known dispute by id", async () => {
    client = await CommasMcpClient.connectMock();
    const result = await client.callTool("commas_get_dispute", { id: "2481" });
    expect(result.isError).toBe(false);
    expect((result.data as { dispute: { reason: string } }).dispute.reason).toBe("product_not_received");
  });
});

describe("CommasMcpClient — real mode connection failure (unavailable MCP server)", () => {
  it("throws a classifiable McpConnectionError when the real server is unreachable", async () => {
    // Port 1 is a real, permanently-unassigned reserved port — nothing listens there, so
    // this is a genuine connection-refused, not a mock. Proves the real-mode transport is
    // actually wired, not just theoretical.
    await expect(CommasMcpClient.connectReal("http://127.0.0.1:1/mcp", "fake-key")).rejects.toThrow(McpConnectionError);
  }, 15000);
});
