// @vitest-environment node
import { describe, expect, it, afterEach } from "vitest";
import { CommasMcpClient } from "../../server/mcp/client.js";
import { buildToolRegistry, classifyToolName, listAvailableTools } from "../../server/agent/registry.js";

describe("classifyToolName", () => {
  it("classifies the four known Commas tools as read", () => {
    for (const name of [
      "fanbasis_list_customers",
      "fanbasis_list_transactions",
      "fanbasis_get_transaction",
      "commas_get_dispute",
    ]) {
      expect(classifyToolName(name).classification).toBe("read");
    }
  });

  it("fails safe: an unrecognized tool name defaults to write, never auto-runnable as read", () => {
    const result = classifyToolName("some_tool_nobody_registered");
    expect(result.classification).toBe("write");
  });
});

describe("buildToolRegistry (tool discovery)", () => {
  let client: CommasMcpClient;
  afterEach(async () => {
    await client?.close();
  });

  it("discovers tools from the MCP server's tools/list — not from a hardcoded UI list", async () => {
    client = await CommasMcpClient.connectMock();
    const registry = await buildToolRegistry(client);

    expect(new Set(registry.keys())).toEqual(
      new Set(["fanbasis_list_customers", "fanbasis_list_transactions", "fanbasis_get_transaction", "commas_get_dispute"]),
    );

    const listed = listAvailableTools(registry);
    expect(listed.every((t) => t.sourceId === "commas")).toBe(true);
    expect(listed.every((t) => t.classification === "read")).toBe(true);
  });
});
