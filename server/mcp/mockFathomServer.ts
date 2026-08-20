import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Mock Fathom MCP server — PROTOTYPE DATA ONLY, no real Fathom account or API involved.
 * Fathom has no publicly documented MCP server (unlike Commas), so this is a plausible mock
 * shape only, not verified against a real spec — matches src/lib/disputeData.ts's story
 * (Sarah Johnson, Pro Coaching Program, calls on Aug 4 and Aug 6 2026).
 */

interface MockCall {
  id: string;
  attendeeEmail: string;
  title: string;
  occurredAt: string;
  durationMinutes: number;
  summary: string;
}

const CALLS: MockCall[] = [
  {
    id: "fathom_call_1",
    attendeeEmail: "sarah.johnson@email.com",
    title: "Pro Coaching Program — Onboarding call",
    occurredAt: "2026-08-04T15:00:00Z",
    durationMinutes: 42,
    summary: "Walked Sarah through the portal, first-week goals, and how to book live sessions.",
  },
  {
    id: "fathom_call_2",
    attendeeEmail: "sarah.johnson@email.com",
    title: "Pro Coaching Program — Week 2 group coaching session",
    occurredAt: "2026-08-06T16:00:00Z",
    durationMinutes: 55,
    summary: "Group session covering goal mapping; Sarah attended and participated actively.",
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
