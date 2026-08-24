/**
 * Vercel Edge Middleware — gates the entire deployed app (static frontend + /api/*) behind a
 * single shared password, using plain HTTP Basic Auth. This is the simplest genuinely-free
 * option on Vercel: Edge Middleware runs on every request on the Hobby (free) plan, no paid
 * "Vercel Authentication"/"Password Protection" add-on required, and no server infrastructure
 * beyond what's already deployed.
 *
 * The password is never shipped to the client: it lives only in the `SITE_PASSWORD` environment
 * variable (configured in the Vercel project, never committed — see .env.example) and is
 * compared here, server-side, before the request reaches the static build or any API route. A
 * request with no/incorrect credentials gets a 401 with a `WWW-Authenticate` challenge, which
 * every browser renders as its native login prompt — no custom login page or session/cookie
 * handling to build or secure.
 *
 * If `SITE_PASSWORD` isn't set (e.g. a preview deploy without it configured), the app is left
 * open rather than locking everyone out silently — set the env var in the Vercel dashboard for
 * every environment that should be gated.
 */
export const config = {
  matcher: "/(.*)",
};

export default function middleware(request: Request): Response | undefined {
  const password = process.env.SITE_PASSWORD;
  if (!password) return undefined;

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");
    const suppliedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;
    if (suppliedPassword === password) return undefined;
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Commas AI Agent — private demo", charset="UTF-8"' },
  });
}
