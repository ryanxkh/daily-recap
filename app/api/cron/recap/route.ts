/**
 * Cron endpoint — invoked daily at 6pm CT by Vercel Cron (see vercel.json).
 *
 * Auth model: Vercel Cron sends an `Authorization: Bearer <CRON_SECRET>`
 * header. We verify it matches the env var; anything else returns 401.
 *
 * Handler body is intentionally small — we kick off the WDK workflow with
 * `start()` (fire-and-forget; returns a runId immediately) and return. The
 * actual recap work happens asynchronously in the workflow runtime.
 */

import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { dailyRecapWorkflow } from "@/lib/workflow";

const DEFAULT_TIMEZONE = "America/Chicago";

export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now();

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn(
      JSON.stringify({ event: "cron.unauthorized", ip: request.headers.get("x-forwarded-for") }),
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tz = process.env.TIMEZONE ?? DEFAULT_TIMEZONE;
  const now = new Date();

  // Date-as-a-string in the configured timezone, e.g. "2026-04-20".
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const date = formatter.format(now); // en-CA gives "YYYY-MM-DD"

  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
  }).format(now);

  console.log(JSON.stringify({ event: "cron.trigger.start", date, dayOfWeek, tz }));

  try {
    const run = await start(dailyRecapWorkflow, [
      { date, dayOfWeek, timezone: tz },
    ]);

    console.log(
      JSON.stringify({
        event: "cron.trigger.started",
        runId: run.runId,
        date,
        durationMs: Date.now() - startedAt,
      }),
    );

    return NextResponse.json({
      ok: true,
      runId: run.runId,
      date,
      dayOfWeek,
      timezone: tz,
      inspect: `npx workflow inspect run ${run.runId} --backend vercel --project daily-recap`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        event: "cron.trigger.failed",
        msg,
        date,
        durationMs: Date.now() - startedAt,
      }),
    );
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
