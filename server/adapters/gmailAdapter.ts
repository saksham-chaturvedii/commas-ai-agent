import type { AdapterToolDef, SourceAdapter } from "./types.js";
import { jsonResult } from "./types.js";

/**
 * API-style adapter — PROTOTYPE DATA ONLY. Gmail has no MCP server in this project's scope;
 * a real integration would call the Gmail API directly after OAuth, which is exactly what
 * `callTool` below stands in for (same method shape, mock response instead of a real HTTP
 * call) — swapping in real OAuth + the Gmail API later changes only this file's internals,
 * not the Agent or the tool registry.
 */

interface MockThread {
  id: string;
  withEmail: string;
  subject: string;
  messages: { from: string; sentAt: string; snippet: string }[];
}

const THREADS: MockThread[] = [
  {
    id: "gmail_thread_1",
    withEmail: "sarah.johnson@email.com",
    subject: "Welcome to Pro Coaching Program",
    messages: [
      { from: "support@commas-seller.example", sentAt: "2026-08-02T14:33:00Z", snippet: "Welcome! Here's your login link to get started right away." },
      { from: "sarah.johnson@email.com", sentAt: "2026-08-02T14:40:00Z", snippet: "Hi, I just purchased but I'm not sure how to access it — can you help?" },
      { from: "support@commas-seller.example", sentAt: "2026-08-02T15:02:00Z", snippet: "Here's the direct link too. Let me know if you have trouble logging in!" },
      { from: "sarah.johnson@email.com", sentAt: "2026-08-03T10:35:00Z", snippet: "Got it, thanks! I'm in now." },
    ],
  },
];

export class GmailAdapter implements SourceAdapter {
  readonly sourceId = "gmail" as const;
  readonly kind = "api" as const;

  async listTools(): Promise<AdapterToolDef[]> {
    return [
      {
        name: "gmail_search_threads",
        description: "Search email threads with a customer by their email address.",
        inputSchema: { type: "object", properties: { with_email: { type: "string" } } },
      },
    ];
  }

  async callTool(name: string, args: Record<string, unknown>) {
    if (name !== "gmail_search_threads") return { isError: true, data: `Unknown tool: ${name}`, rawText: `Unknown tool: ${name}` };
    const withEmail = typeof args.with_email === "string" ? args.with_email.toLowerCase() : undefined;
    const threads = withEmail ? THREADS.filter((t) => t.withEmail.toLowerCase() === withEmail) : THREADS;
    return jsonResult({ threads });
  }
}
