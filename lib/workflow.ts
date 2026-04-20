"use workflow";

/**
 * Daily recap workflow — the WDK orchestrator.
 *
 * Runs five steps:
 *   1. runClaudeInSandbox     — boot sandbox, run Claude, return parsed Recap
 *   2+3. Parallel fan-out:
 *        writeNotionPage      — create page in Daily Briefs database
 *        writeArchiveMarkdown — commit .md file to private archive repo
 *   4. sendSlackDM            — post TL;DR + link to Notion page
 *   5. logRunMetadata         — light touch; WDK already captures most run data
 *
 * The "use workflow" directive makes this function durable and replay-safe.
 * It runs in a sandboxed VM with no fetch / no Node modules — all I/O must
 * happen inside "use step" functions.
 */

import { FatalError, RetryableError } from "workflow";
import { runClaudeInSandbox } from "./sandbox";
import { writeNotionPage } from "./sinks/notion";
import { writeArchiveMarkdown } from "./sinks/github";
import { sendSlackDM, sendSlackErrorAlert } from "./sinks/slack";
import type { Recap } from "./schema";

export async function dailyRecapWorkflow(params: {
  date: string;         // "2026-04-20"
  dayOfWeek: string;    // "Monday"
  timezone: string;     // "America/Chicago"
}) {
  console.log(
    JSON.stringify({ event: "workflow.start", date: params.date, dow: params.dayOfWeek }),
  );

  let recap: Recap;

  // Step 1 — the expensive one. Caches on success so downstream retries
  // don't re-invoke Claude.
  try {
    recap = await runClaudeStep(params);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "workflow.abort",
        phase: "claude",
        msg: err instanceof Error ? err.message : String(err),
      }),
    );
    await alertStep({
      phase: "claude",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // Steps 2 & 3 — parallel fan-out. Independent failures; each is retriable
  // on its own without re-running step 1.
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

  // Step 4 — Slack DM with TL;DR + link. Depends on Notion URL when available;
  // falls back to "Notion write failed" note if it didn't work.
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
    // Non-fatal — we still have the Notion page + archive
  }

  // Step 5 — log run metadata. WDK already captures step timings and retries
  // via `npx workflow inspect runs`; this is just a breadcrumb.
  await logStep(recap);

  console.log(JSON.stringify({ event: "workflow.end", date: params.date }));
}

// ------------------------ Step wrappers ------------------------

async function runClaudeStep(params: {
  date: string;
  dayOfWeek: string;
  timezone: string;
}): Promise<Recap> {
  "use step";
  console.log(JSON.stringify({ event: "step.claude.start", date: params.date }));
  try {
    const recap = await runClaudeInSandbox(params);
    console.log(
      JSON.stringify({
        event: "step.claude.end",
        date: params.date,
        sources_available: recap.sources_available,
        sources_degraded: recap.sources_degraded,
      }),
    );
    return recap;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "step.claude.error", msg }));
    // MCP auth failures should NOT retry — a bad token is a bad token.
    if (/auth|unauthorized|401|403|invalid.*token/i.test(msg)) {
      throw new FatalError(`Auth failure in Claude run: ${msg}`);
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
