/**
 * Shared types for source prefetch results.
 *
 * Each source function returns `Result<T>`:
 *   - ok=true  → data populated
 *   - ok=false → reason populated, data is null
 *
 * The workflow aggregates Results and builds `sources_available` /
 * `sources_degraded` for the prompt and the output schema.
 */

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

export interface DateWindow {
  /** ISO YYYY-MM-DD in the configured timezone */
  date: string;
  /** Timezone string e.g. "America/Chicago" */
  timezone: string;
}

/**
 * Convert a timezone-local date like "2026-04-20" to the UTC epoch-ms
 * boundary for that day's start/end.
 */
export function dateToUTCWindow(d: DateWindow): { startMs: number; endMs: number } {
  // We construct midnight in the target TZ, then convert to UTC.
  // Approach: format the intended midnight as a literal ISO string with the
  // timezone offset at that point in the year (handles DST).
  const { date, timezone } = d;
  const [y, m, day] = date.split("-").map(Number);

  // Probe the tz offset on this date by formatting a known UTC time in that tz.
  const probeUTC = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  const offsetMin = getTimezoneOffsetMinutes(probeUTC, timezone);

  // Midnight local = offsetMin before UTC midnight (positive offset west of UTC = negative delta to UTC)
  const startUTC = Date.UTC(y, m - 1, day, 0, 0, 0) + offsetMin * 60_000;
  const endUTC = startUTC + 24 * 60 * 60 * 1000;
  return { startMs: startUTC, endMs: endUTC };
}

function getTimezoneOffsetMinutes(atUTC: Date, timezone: string): number {
  // Returns minutes to ADD to UTC to get local. E.g. CDT returns -300.
  // We invert convention to "minutes to add to local midnight to get UTC midnight"
  // by returning the positive offset (= how far west of UTC).
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(atUTC).map((p) => [p.type, p.value]),
  );
  const localAsUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (atUTC.getTime() - localAsUTC) / 60_000;
}
