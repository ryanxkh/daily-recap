/**
 * Google Calendar source — list today's events for the primary calendar.
 */

import { google } from "googleapis";
import { getGoogleOAuthClient } from "./google-client";
import { dateToUTCWindow, type DateWindow, type Result } from "./types";

export interface CalendarEvent {
  id: string;
  start: string;              // ISO datetime
  end: string;                // ISO datetime
  summary: string;
  attendees: string[];        // email list
  isRecurring: boolean;
  isAllDay: boolean;
  location?: string;
  description?: string;
  htmlLink: string;
}

export async function fetchCalendar(window: DateWindow): Promise<Result<CalendarEvent[]>> {
  try {
    const auth = getGoogleOAuthClient();
    const calendar = google.calendar({ version: "v3", auth });

    const { startMs, endMs } = dateToUTCWindow(window);
    const timeMin = new Date(startMs).toISOString();
    const timeMax = new Date(endMs).toISOString();

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,        // expand recurring events into instances
      orderBy: "startTime",
      maxResults: 50,
    });

    const events: CalendarEvent[] = (res.data.items ?? []).map((e) => ({
      id: e.id ?? "",
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      summary: e.summary ?? "(no title)",
      attendees: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
      isRecurring: Boolean(e.recurringEventId),
      isAllDay: !e.start?.dateTime,
      location: e.location ?? undefined,
      description: e.description ?? undefined,
      htmlLink: e.htmlLink ?? "",
    }));

    return { ok: true, data: events };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
