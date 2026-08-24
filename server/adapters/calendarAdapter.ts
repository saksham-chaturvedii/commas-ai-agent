import type { AdapterToolDef, SourceAdapter } from "./types.js";
import { jsonResult } from "./types.js";

/** API-style adapter — PROTOTYPE DATA ONLY, no real Google Calendar/OAuth involved. Sarah's two
 * sessions match the Fathom/Zoom mocks (Aug 4, Aug 6); Marcus's scheduled 1:1 Strategy Call
 * (Aug 13) matches his Fathom/Zoom records too — `durationMinutes` documents what was BOOKED,
 * for comparison against how long the call actually ran (see mockFathomServer.ts). */

interface MockEvent {
  id: string;
  attendeeEmail: string;
  title: string;
  startAt: string;
  durationMinutes: number;
  status: "accepted" | "declined" | "no_response";
}

const EVENTS: MockEvent[] = [
  {
    id: "cal_evt_1",
    attendeeEmail: "sarah.johnson@email.com",
    title: "Pro Coaching Program — Onboarding call",
    startAt: "2026-08-04T15:00:00Z",
    durationMinutes: 45,
    status: "accepted",
  },
  {
    id: "cal_evt_2",
    attendeeEmail: "sarah.johnson@email.com",
    title: "Pro Coaching Program — Week 2 group coaching session",
    startAt: "2026-08-06T16:00:00Z",
    durationMinutes: 60,
    status: "accepted",
  },
  {
    id: "cal_evt_3",
    attendeeEmail: "marcus.webb@email.com",
    title: "1:1 Strategy Call — Marcus Webb",
    startAt: "2026-08-13T18:00:00Z",
    durationMinutes: 30,
    status: "accepted",
  },
];

export class CalendarAdapter implements SourceAdapter {
  readonly sourceId = "google-calendar" as const;
  readonly kind = "api" as const;

  async listTools(): Promise<AdapterToolDef[]> {
    return [
      {
        name: "calendar_list_events",
        description: "List calendar events for an attendee email.",
        inputSchema: { type: "object", properties: { attendee_email: { type: "string" } } },
      },
    ];
  }

  async callTool(name: string, args: Record<string, unknown>) {
    if (name !== "calendar_list_events") return { isError: true, data: `Unknown tool: ${name}`, rawText: `Unknown tool: ${name}` };
    const email = typeof args.attendee_email === "string" ? args.attendee_email.toLowerCase() : undefined;
    const events = email ? EVENTS.filter((e) => e.attendeeEmail.toLowerCase() === email) : EVENTS;
    return jsonResult({ events });
  }
}
