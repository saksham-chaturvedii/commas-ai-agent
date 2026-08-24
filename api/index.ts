import { handle } from "hono/vercel";
import { createApp } from "../server/app.js";

/**
 * Vercel serverless entry point — the only bridge between a deployed request and the real Hono
 * app (server/app.ts). All requests under /api/* (health, tools, agent/run, agent/approve,
 * agent/stream) are routed here by vercel.json's rewrite (`/api/(.*)` -> `/api`) with their
 * original path intact, so the Hono app's own routes (defined with full "/api/..." paths) match
 * exactly as they do in local dev (server/index.ts) and in tests (createApp().request()).
 *
 * This is a fixed filename (`api/index.ts` + an explicit rewrite), not Vercel's `[...path].ts`
 * filesystem catch-all — that convention only matched a single path segment for this project
 * once actually deployed (`/api/tools` worked, `/api/agent/run` 404'd), confirmed live via
 * `vercel logs`/curl, not assumed. The rewrite-based approach is the well-established pattern
 * for putting a single framework app (Hono, Express, ...) behind one Vercel function.
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

/**
 * Vercel's Node.js function builder inspects the exported function signature: a `(req, res)`
 * default export is treated as the legacy Node-style handler (return values silently ignored,
 * the caller must write to `res` itself), which left this route hanging forever on every real
 * request once deployed (confirmed via `vercel logs` — a caught bug, not a hypothetical one).
 * Exporting `fetch` instead opts into the Web-standard `(Request) => Response` signature, which
 * is what `hono/vercel`'s `handle()` produces.
 */
export async function fetch(req: Request): Promise<Response> {
  const app = await getApp();
  return handle(app)(req);
}

export const config = {
  runtime: "nodejs",
};
