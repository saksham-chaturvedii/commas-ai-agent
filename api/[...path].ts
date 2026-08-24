import { handle } from "hono/vercel";
import { createApp } from "../server/app.js";

/**
 * Vercel serverless entry point — the only bridge between a deployed request and the real Hono
 * app (server/app.ts). `[...path].ts` is Vercel's catch-all filesystem route, so every request
 * under /api/* (health, tools, agent/run, agent/approve, agent/stream) lands here with its
 * original path intact; the Hono app's own routes (defined with full "/api/..." paths) match it
 * exactly as they do in local dev (server/index.ts) and in tests (createApp().request()).
 *
 * `createApp()` is async (it connects the in-process MCP mock servers and builds the tool
 * registry) and expensive to redo per request, so it's memoized once per warm serverless
 * instance — the same singleton-per-process pattern `server/index.ts` gets for free by only
 * calling it once at boot. A cold start pays this cost; a warm invocation reuses it.
 */
let appPromise: ReturnType<typeof createApp> | undefined;

function getApp() {
  if (!appPromise) appPromise = createApp();
  return appPromise;
}

export default async function handler(req: Request): Promise<Response> {
  const app = await getApp();
  return handle(app)(req);
}

export const config = {
  runtime: "nodejs",
};
