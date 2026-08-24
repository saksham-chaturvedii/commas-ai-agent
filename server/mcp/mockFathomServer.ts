import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Mock Fathom MCP server — PROTOTYPE DATA ONLY, no real Fathom account or API involved.
 * Fathom has no publicly documented MCP server (unlike Commas), so this is a plausible mock
 * shape only, not verified against a real spec. Sarah Johnson's two calls (Aug 4, Aug 6) match
 * src/lib/disputeData.ts's story; Marcus Webb's call (Aug 13) is deliberately genuinely
 * ambiguous evidence for his "product_unacceptable" dispute — it happened (contradicting a
 * literal "never received the service" reading) but ran noticeably short against the 30 minutes
 * booked (server/adapters/calendarAdapter.ts), which is real, if partial, support for his
 * complaint. `recordingUrl` is a mock reference only — never a real file.
 */

interface MockCall {
  id: string;
  attendeeEmail: string;
  title: string;
  occurredAt: string;
  durationMinutes: number;
  summary: string;
  transcriptExcerpt: string;
  recordingUrl: string;
}

const CALLS: MockCall[] = [
  {
    id: "fathom_call_1",
    attendeeEmail: "sarah.johnson@email.com",
    title: "Pro Coaching Program — Onboarding call",
    occurredAt: "2026-08-04T15:00:00Z",
    durationMinutes: 42,
    summary: "Walked Sarah through the portal, first-week goals, and how to book live sessions.",
    transcriptExcerpt: "\"...so once you're in the portal, module one is right there on the dashboard — go ahead and bookmark it...\"",
    recordingUrl: "mock://fathom/recordings/fathom_call_1",
  },
  {
    id: "fathom_call_2",
    attendeeEmail: "sarah.johnson@email.com",
    title: "Pro Coaching Program — Week 2 group coaching session",
    occurredAt: "2026-08-06T16:00:00Z",
    durationMinutes: 55,
    summary: "Group session covering goal mapping; Sarah attended and participated actively.",
    transcriptExcerpt: "\"...great question, Sarah — let's map that goal out on the board for everyone...\"",
    recordingUrl: "mock://fathom/recordings/fathom_call_2",
  },
  {
    id: "fathom_call_3",
    attendeeEmail: "marcus.webb@email.com",
    title: "1:1 Strategy Call — Marcus Webb",
    occurredAt: "2026-08-13T18:00:00Z",
    durationMinutes: 14,
    summary: "Covered goal-setting basics; call ended before reaching the personalized strategy roadmap the offer page describes.",
    transcriptExcerpt: "\"...I have another call starting soon, so let's wrap here — I'll send you some notes on next steps...\"",
    recordingUrl: "mock://fathom/recordings/fathom_call_3",
  },
];

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

export function createMockFathomServer(): McpServer {
  const server = new McpServer({ name: "fathom-mock", version: "0.1.0" });

  server.registerTool(
    "fathom_search_calls",
    {
      title: "Search Fathom calls",
      description: "Search recorded/summarized calls, optionally by attendee email.",
      inputSchema: { attendee_email: z.string().optional() },
    },
    async ({ attendee_email }) => {
      const results = attendee_email
        ? CALLS.filter((c) => c.attendeeEmail.toLowerCase() === attendee_email.toLowerCase())
        : CALLS;
      return textResult({ calls: results });
    },
  );

  return server;
}
