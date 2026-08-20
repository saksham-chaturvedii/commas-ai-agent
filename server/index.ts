import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

/**
 * Entry point — binds a real port. See server/app.ts for the actual app (endpoints, MCP
 * connection, LLM selection); it's factored out so tests can drive it via Hono's in-memory
 * `app.request()` without a network listener.
 */
async function main() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Commas AI Agent backend listening on http://localhost:${info.port}`);
  });
}

main();
