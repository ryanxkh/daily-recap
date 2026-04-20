"use workflow";

/**
 * Daily recap workflow — WDK orchestrator for Option F.
 *
 * Flow:
 *   1. Parallel prefetch (5 steps): calendar, gmail, slack, notion, github
 *   2. Synthesize: boot sandbox, run Claude on the prefetched data, return Recap
 *   3. Parallel fan-out: write Notion page + archive markdown
 *   4. Slack DM with TL;DR + link to Notion page
 *   5. Log run metadata
 *
 * Each step has entry/exit logs and uses FatalError vs RetryableError per
 * failure mode. The workflow function itself orchestrates only — no I/O.
 */

import { FatalError, RetryableError } from "workflow";

import { fetchCalendar } from "./sources/calendar";
import { fetchGmail } from "./sources/gmail";
import { fetchSlack } from "./sources/slack";
import { fetchNotionEdits } from "./sources/notion-reads";
import { fetchGitHub } from "./sources/github-reads";
import type { DateWindow } from "./sources/types";

import { runClaudeInSandbox } from "./sandbox";
import { writeNotionPage } from "./sinks/notion";
import { writeArchiveMarkdown } from "./sinks/github";
import { sendSlackDM, sendSlackErrorAlert } from "./sinks/slack";

import type { PromptContext } from "./prompt";
import type { Recap } from "./schema";

export async function dailyRecapWorkflow(params: {
  date: string;
  dayOfWeek: string;
  timezone: string;
}) {
  console.log(
    JSON.stringify({ event: "workflow.start", date: params.date, dow: params.dayOfWeek }),
  );

  // ---------- Step 1: parallel prefetch ----------
  console.log(JSON.stringify({ event: "workflow.prefetch.start", date: params.date }));
  const window = { date: params.date, timezone: params.timezone };
  const [calendar, gmail, slack, notion, github] = await Promise.all([
    prefetchCalendar(window),
    prefetchGmail(window),
    prefetchSlack(window),
    prefetchNotion(window),
    prefetchGitHub(window),
  ]);
  console.log(
    JSON.stringify({
      event: "workflow.prefetch.end",
      date: params.date,
      calendar: calendar.ok,
      gmail: gmail.ok,
      slack: slack.ok,
      notion: notion.ok,
      github: github.ok,
    }),
  );

  const ctx: PromptContext = {
    date: params.date,
    dayOfWeek: params.dayOfWeek,
    timezone: params.timezone,
    sources: { calendar, gmail, slack, notion, github },
  };

  // ---------- Step 2: synthesize in sandbox ----------
  let recap: Recap;
  try {
    recap = await synthesizeStep(ctx);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "workflow.abort",
        phase: "synthesize",
        msg: err instanceof Error ? err.message : String(err),
      }),
    );
    await alertStep({
      phase: "claude",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // ---------- Step 3: parallel fan-out ----------
  console.log(JSON.stringify({ event: "workflow.fanout.start", date: params.date }));
  const [notionResult, archiveResult] = await Promise.allSettled([
    notionStep(recap),
    archiveStep(recap),
  ]);
  console.log(
    JSON.stringify({
      event: "workflow.fanout.end",
      date: params.date,
      notionStatus: notionResult.status,
      archiveStatus: archiveResult.status,
    }),
  );

  const notionUrl =
    notionResult.status === "fulfilled" ? notionResult.value.url : undefined;

  // ---------- Step 4: Slack DM ----------
  try {
    await slackStep({
      recap,
      notionUrl,
      notionFailed: notionResult.status === "rejected",
      archiveFailed: archiveResult.status === "rejected",
    });
  } catch (err) {
    await alertStep({
      phase: "slack",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ---------- Step 5: log ----------
  await logStep(recap);

  console.log(JSON.stringify({ event: "workflow.end", date: params.date }));
}

// ------------------------ Prefetch steps ------------------------
// Each is its own retriable step so one flaky API doesn't require
// re-running the others.

async function prefetchCalendar(p: DateWindow) {
  "use step";
  console.log(JSON.stringify({ event: "step.prefetch.calendar.start", date: p.date }));
  const r = await fetchCalendar(p);
  console.log(
    JSON.stringify({
      event: "step.prefetch.calendar.end",
      date: p.date,
      ok: r.ok,
      count: r.ok ? r.data.length : 0,
    }),
  );
  return r;
}

async function prefetchGmail(p: DateWindow) {
  "use step";
  console.log(JSON.stringify({ event: "step.prefetch.gmail.start", date: p.date }));
  const r = await fetchGmail(p);
  console.log(
    JSON.stringify({
      event: "step.prefetch.gmail.end",
      date: p.date,
      ok: r.ok,
      count: r.ok ? r.data.length : 0,
    }),
  );
  return r;
}

async function prefetchSlack(p: DateWindow) {
  "use step";
  console.log(JSON.stringify({ event: "step.prefetch.slack.start", date: p.date }));
  const r = await fetchSlack(p);
  console.log(
    JSON.stringify({
      event: "step.prefetch.slack.end",
      date: p.date,
      ok: r.ok,
      count: r.ok ? r.data.length : 0,
    }),
  );
  return r;
}

async function prefetchNotion(p: DateWindow) {
  "use step";
  console.log(JSON.stringify({ event: "step.prefetch.notion.start", date: p.date }));
  const r = await fetchNotionEdits(p);
  console.log(
    JSON.stringify({
      event: "step.prefetch.notion.end",
      date: p.date,
      ok: r.ok,
      count: r.ok ? r.data.length : 0,
    }),
  );
  return r;
}

async function prefetchGitHub(p: DateWindow) {
  "use step";
  console.log(JSON.stringify({ event: "step.prefetch.github.start", date: p.date }));
  const r = await fetchGitHub(p);
  console.log(
    JSON.stringify({
      event: "step.prefetch.github.end",
      date: p.date,
      ok: r.ok,
      count: r.ok ? r.data.length : 0,
    }),
  );
  return r;
}

// ------------------------ Synthesis + sinks ------------------------

async function synthesizeStep(ctx: PromptContext): Promise<Recap> {
  "use step";
  console.log(JSON.stringify({ event: "step.synthesize.start", date: ctx.date }));
  try {
    const recap = await runClaudeInSandbox(ctx);
    console.log(
      JSON.stringify({
        event: "step.synthesize.end",
        date: ctx.date,
        sources_available: recap.sources_available,
        sources_degraded: recap.sources_degraded,
      }),
    );
    return recap;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "step.synthesize.error", msg }));
    if (/auth|unauthorized|401|403|invalid.*token/i.test(msg)) {
      throw new FatalError(`Auth failure in synthesis: ${msg}`);
    }
    throw new RetryableError(msg, { retryAfter: "2m" });
  }
}

async function notionStep(recap: Recap): Promise<{ url: string }> {
  "use step";
  console.log(JSON.stringify({ event: "step.notion.start", date: recap.date }));
  try {
    const out = await writeNotionPage(recap);
    console.log(JSON.stringify({ event: "step.notion.end", url: out.url }));
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "step.notion.error", msg }));
    if (/rate.*limit|429/i.test(msg)) {
      throw new RetryableError(msg, { retryAfter: "30s" });
    }
    throw new FatalError(msg);
  }
}

async function archiveStep(recap: Recap): Promise<{ path: string }> {
  "use step";
  console.log(JSON.stringify({ event: "step.archive.start", date: recap.date }));
  try {
    const out = await writeArchiveMarkdown(recap);
    console.log(JSON.stringify({ event: "step.archive.end", path: out.path }));
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "step.archive.error", msg }));
    if (/rate.*limit|429|5\d\d/.test(msg)) {
      throw new RetryableError(msg, { retryAfter: "1m" });
    }
    throw new FatalError(msg);
  }
}

async function slackStep(input: {
  recap: Recap;
  notionUrl?: string;
  notionFailed: boolean;
  archiveFailed: boolean;
}): Promise<void> {
  "use step";
  console.log(
    JSON.stringify({
      event: "step.slack.start",
      date: input.recap.date,
      notionFailed: input.notionFailed,
      archiveFailed: input.archiveFailed,
    }),
  );
  await sendSlackDM(input);
  console.log(JSON.stringify({ event: "step.slack.end", date: input.recap.date }));
}

async function alertStep(input: {
  phase: "claude" | "slack" | "notion" | "archive" | "unknown";
  message: string;
}): Promise<void> {
  "use step";
  console.log(JSON.stringify({ event: "step.alert.start", phase: input.phase }));
  await sendSlackErrorAlert(input).catch((e) => {
    console.error(
      JSON.stringify({
        event: "step.alert.error",
        msg: e instanceof Error ? e.message : String(e),
      }),
    );
  });
  console.log(JSON.stringify({ event: "step.alert.end", phase: input.phase }));
}

async function logStep(recap: Recap): Promise<void> {
  "use step";
  console.log(
    JSON.stringify({
      event: "daily_recap.completed",
      date: recap.date,
      sources_available: recap.sources_available,
      sources_degraded: recap.sources_degraded,
      tldr_count: recap.tldr_bullets.length,
    }),
  );
}
