import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Mock Zoom MCP server — PROTOTYPE DATA ONLY. Zoom has no publicly documented MCP server used
 * by this project, so this is a plausible mock shape, corroborating the same calls as
 * mockFathomServer.ts (matching join times/durations) — that corroboration is the point of
 * having both. Marcus Webb's meeting corroborates Fathom's ~14-minute duration specifically:
 * two independent sources agreeing the call ran short is stronger evidence than either alone.
 */

interface MockMeeting {
  id: string;
  attendeeEmail: string;
  topic: string;
  joinedAt: string;
  leftAt: string;
  durationMinutes: number;
}

const MEETINGS: MockMeeting[] = [
  {
    id: "zoom_mtg_1",
    attendeeEmail: "sarah.johnson@email.com",
    topic: "Pro Coaching Program — Onboarding call",
    joinedAt: "2026-08-04T15:01:00Z",
    leftAt: "2026-08-04T15:42:00Z",
    durationMinutes: 41,
  },
  {
    id: "zoom_mtg_2",
    attendeeEmail: "sarah.johnson@email.com",
    topic: "Pro Coaching Program — Week 2 group coaching session",
    joinedAt: "2026-08-06T16:02:00Z",
    leftAt: "2026-08-06T16:56:00Z",
    durationMinutes: 54,
  },
  {
    id: "zoom_mtg_3",
    attendeeEmail: "marcus.webb@email.com",
    topic: "1:1 Strategy Call — Marcus Webb",
    joinedAt: "2026-08-13T18:00:00Z",
    leftAt: "2026-08-13T18:14:00Z",
    durationMinutes: 14,
  },
];

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

export function createMockZoomServer(): McpServer {
  const server = new McpServer({ name: "zoom-mock", version: "0.1.0" });

  server.registerTool(
    "zoom_list_meetings",
    {
      title: "List Zoom meetings",
      description: "List meeting occurrences, optionally by attendee email.",
      inputSchema: { attendee_email: z.string().optional() },
    },
    async ({ attendee_email }) => {
      const results = attendee_email
        ? MEETINGS.filter((m) => m.attendeeEmail.toLowerCase() === attendee_email.toLowerCase())
        : MEETINGS;
      return textResult({ meetings: results });
    },
  );

  return server;
}
