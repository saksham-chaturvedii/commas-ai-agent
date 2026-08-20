import { createMockFathomServer } from "../mcp/mockFathomServer.js";
import { createMockZoomServer } from "../mcp/mockZoomServer.js";
import { connectInProcess } from "../mcp/connectInProcess.js";
import { McpSourceAdapter } from "./mcpAdapter.js";

export async function createFathomAdapter(): Promise<McpSourceAdapter> {
  const client = await connectInProcess(createMockFathomServer(), "commas-ai-agent");
  return new McpSourceAdapter("fathom", client);
}

export async function createZoomAdapter(): Promise<McpSourceAdapter> {
  const client = await connectInProcess(createMockZoomServer(), "commas-ai-agent");
  return new McpSourceAdapter("zoom", client);
}
