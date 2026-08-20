import type { AdapterToolDef, SourceAdapter } from "./types.js";
import { jsonResult } from "./types.js";

/** API-style adapter — PROTOTYPE DATA ONLY, no real Google Calendar/OAuth involved. Same
 * two sessions as the Fathom/Zoom mocks (Aug 4, Aug 6), as accepted calendar invitations. */

interface MockEvent {
  id: string;
  attendeeEmail: string;
  title: string;
  startAt: string;
  status: "accepted" | "declined" | "no_response";
}

const EVENTS: MockEvent[] = [
  {
    id: "cal_evt_1",
    attendeeEmail: "sarah.johnson@email.com",
    title: "Pro Coaching Program — Onboarding call",
    startAt: "2026-08-04T15:00:00Z",
    status: "accepted",
  },
  {
    id: "cal_evt_2",
    attendeeEmail: "sarah.johnson@email.com",
    title: "Pro Coaching Program — Week 2 group coaching session",
    startAt: "2026-08-06T16:00:00Z",
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
