# Daily recap agent — how it works, piece by piece

This document is a reference for me and anyone who wants to stand up something similar. It covers what the system does, what's in the stack and why each piece is there, the implementation order, and the verbatim code for every load-bearing file.

## What this solves

Every evening I used to spend ten to twenty minutes tying off the day: bullets in Notion, a reply to the one thing I forgot about, a note on what I owe someone tomorrow. Some days I skipped it and lost state. Over a week that compounded into "did I ever respond to X" moments that I couldn't reconstruct.

This system does that work for me at 6pm Central every day. It pulls my activity from Google Calendar, Gmail, Slack, Notion, and GitHub, hands the combined blob to Claude Code running in a sandboxed VM, and fans the structured result out to three places I'll actually read: a page in a Notion database called Daily Briefs, a dated markdown file in a private GitHub archive repo, and a Slack DM with the three-to-five bullets that matter most.

Specific problems it addresses:
- **State loss between days.** The recap compounds into a searchable archive of what I did, committed to, and learned.
- **Unanswered asks.** The `loose_ends` section flags emails and DMs I didn't reply to.
- **Meeting prep tax.** `tomorrow_on_deck` lists tomorrow's meetings with one-line prep notes (v1.5 — currently empty until the prefetch grabs tomorrow's calendar).
- **Selective attention.** Hard selectivity rules in the prompt drop the noise (promo emails, security notifications, scroll-by `@channel` mentions, CI/CD bot chatter) so I don't have to.

## Architecture at a glance

```
Vercel Cron (0 23 * * * UTC = 6pm CT)
  ↓ hits
/api/cron/recap (Next.js App Router route, Node runtime)
  ↓ start() returns runId immediately
dailyRecapWorkflow (WDK, "use workflow")
  ↓
  Step 1 — parallel prefetch (5 "use step" functions)
    Calendar | Gmail | Slack | Notion | GitHub
      each returns Result<T> = { ok: true, data } | { ok: false, reason }
  ↓
  Step 2 — synthesize
    Boot Vercel Sandbox from snap_xxx
    Write prompt + JSON schema to /tmp via heredoc
    Run `claude --print --output-format json --json-schema ...`
    Strip markdown fences, extract JSON from one of several known shapes
    Zod-validate into Recap
  ↓
  Step 3 — parallel fan-out
    writeNotionPage(recap)       → Notion Daily Briefs DB
    writeArchiveMarkdown(recap)  → private github repo commit
  ↓
  Step 4 — sendSlackDM(TL;DR + Notion URL)
  ↓
  Step 5 — log metadata
```

Any prefetch can fail without aborting. The workflow carries `sources_degraded` forward and the recap ships with a visible callout. A hard failure in the synthesis step triggers a Slack error-alert DM and aborts.

## Stack

| Piece | What it does | Why it's here |
|---|---|---|
| Vercel Cron | Fires the route daily at 23:00 UTC | Platform-native scheduler, no separate service to run. Config lives in `vercel.json`. |
| Next.js App Router (Node runtime) | Hosts the cron route handler | The app is Next.js; the route is just another handler. |
| Vercel Workflow (WDK) | Durable orchestration | Each step retries independently, the whole run shows up in a trace view, state survives crashes. |
| Vercel Sandbox | Runs the Claude Code CLI in a Firecracker microVM | Claude Code is a Node process with a filesystem and does not fit in a request-scoped isolate. Booting from a snapshot gives a pre-baked VM in a second or two. |
| Claude Code CLI (`claude`) | Synthesizes the recap from the prefetched blob | The agent loop, model access, and JSON-schema output are all provided. I don't maintain any of that. |
| Zod | Validates the JSON that comes back | One schema drives the JSON schema passed to `claude`, the runtime validation, and the types every sink consumes. |
| Google / Slack / Notion / Octokit SDKs | Deterministic prefetch | Faster, cheaper, and more predictable than asking Claude to page through APIs itself. Tokens never enter the Sandbox. |

`package.json` dependencies:
```json
"dependencies": {
  "@notionhq/client": "^2.3.0",
  "@octokit/rest": "^21.0.0",
  "@slack/web-api": "^7.0.0",
  "@vercel/sandbox": "latest",
  "googleapis": "^144.0.0",
  "next": "^16.0.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "workflow": "latest",
  "zod": "^3.23.0"
}
```

## Implementation order

If I were rebuilding from scratch, this is the order that minimized rework:

1. Scaffold a Next.js App Router project and add `withWorkflow` in `next.config.ts`. Skip this and the `"use workflow"` directive becomes a silent no-op.
2. Write the Zod schema first (`lib/schema.ts`). It's the contract between Claude, the workflow, and the sinks. Everything else conforms to it.
3. Write the prompt builder (`lib/prompt.ts`) against fake prefetch data. Iterate on selectivity and voice rules until you'd be happy reading the output yourself.
4. Set up external access: Google OAuth refresh token via `scripts/auth-google.ts`, Slack app and token, Notion integration and database, GitHub PAT. All tokens go into Vercel env vars.
5. Write one prefetch source end-to-end (Calendar is the simplest). Lock the `Result<T>` shape so the other four are copy-paste.
6. Write the remaining four prefetch sources.
7. Bake the sandbox snapshot with `pnpm run bake-snapshot`. Save the `snap_xxx` ID as `VERCEL_SANDBOX_SNAPSHOT_ID` in Vercel env for both production and development.
8. Write `lib/sandbox.ts` to boot the snapshot, write the prompt and schema via heredoc, run `claude`, and extract the JSON.
9. Write the sinks (`lib/sinks/notion.ts`, `github.ts`, `slack.ts`). The Notion DB needs to exist with the right property schema before the first real run.
10. Wire the WDK orchestrator in `lib/workflow.ts` with `"use workflow"` at the top of the file and `"use step"` at the top of each step function.
11. Write the cron route handler to verify `CRON_SECRET` and call `start(dailyRecapWorkflow, ...)`.
12. Configure the cron in `vercel.json`, deploy, and trigger manually with `curl -H "Authorization: Bearer $CRON_SECRET" https://<prod>/api/cron/recap` before trusting the schedule.

## The code, verbatim

### `next.config.ts`

```ts
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {};

export default withWorkflow(nextConfig);
```

If you skip `withWorkflow`, the `"use workflow"` directive in `lib/workflow.ts` is a no-op and you'll see "invalid workflow function" at runtime instead of a helpful build error. This bit me on first deploy.

### `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/recap",
      "schedule": "0 23 * * *"
    }
  ]
}
```

`0 23 * * *` is 23:00 UTC = 18:00 CDT. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; the route handler verifies it.

### `app/api/cron/recap/route.ts`

```ts
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
```

The handler body is intentionally small. Verify the bearer, compute date/day in the configured timezone, call `start()` which returns a `runId` immediately, and return. The real work happens async in the workflow runtime.

### `lib/schema.ts`

```ts
import { z } from "zod";

export const SourceEnum = z.enum([
  "calendar",
  "gmail",
  "slack",
  "notion",
  "github",
]);
export type Source = z.infer<typeof SourceEnum>;

export const TomorrowMeetingSchema = z.object({
  meeting: z.string().describe("Meeting title or calendar event name"),
  prep_note: z
    .string()
    .describe("One-line prep note: what to think about, who's attending, what to bring"),
});
export type TomorrowMeeting = z.infer<typeof TomorrowMeetingSchema>;

export const SectionsSchema = z.object({
  todays_wins: z.array(z.string()),
  commitments_made: z.array(z.string()),
  loose_ends: z.array(z.string()),
  tomorrow_on_deck: z.array(TomorrowMeetingSchema),
  front_load_candidates: z.array(z.string()),
  watch_list: z.array(z.string()),
  questions_surfaced: z.array(z.string()),
  daily_learning: z.string(),
});
export type Sections = z.infer<typeof SectionsSchema>;

export const RecapSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day_of_week: z.string(),
  sources_available: z.array(SourceEnum),
  sources_degraded: z.array(z.string()),
  sections: SectionsSchema,
  tldr_bullets: z.array(z.string()).min(3).max(5),
});
export type Recap = z.infer<typeof RecapSchema>;
```

The same file also exports `RECAP_JSON_SCHEMA`, a hand-written JSON Schema draft-07 string passed to `claude --json-schema` so Claude returns the right shape. It lives next to the Zod schema so it's obvious when one changes and the other didn't. Full file at `lib/schema.ts`.

### `lib/workflow.ts`

```ts
"use workflow";

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
  const window = { date: params.date, timezone: params.timezone };
  const [calendar, gmail, slack, notion, github] = await Promise.all([
    prefetchCalendar(window),
    prefetchGmail(window),
    prefetchSlack(window),
    prefetchNotion(window),
    prefetchGitHub(window),
  ]);

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
    await alertStep({
      phase: "claude",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // ---------- Step 3: parallel fan-out ----------
  const [notionResult, archiveResult] = await Promise.allSettled([
    notionStep(recap),
    archiveStep(recap),
  ]);

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
}

// ------------------------ Prefetch steps ------------------------
// Each is its own retriable step so one flaky API doesn't require
// re-running the others. Log event shapes shortened here for brevity.

async function prefetchCalendar(p: DateWindow) {
  "use step";
  return fetchCalendar(p);
}

async function prefetchGmail(p: DateWindow) {
  "use step";
  return fetchGmail(p);
}

async function prefetchSlack(p: DateWindow) {
  "use step";
  return fetchSlack(p);
}

async function prefetchNotion(p: DateWindow) {
  "use step";
  return fetchNotionEdits(p);
}

async function prefetchGitHub(p: DateWindow) {
  "use step";
  return fetchGitHub(p);
}

// ------------------------ Synthesis + sinks ------------------------

async function synthesizeStep(ctx: PromptContext): Promise<Recap> {
  "use step";
  try {
    return await runClaudeInSandbox(ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/auth|unauthorized|401|403|invalid.*token/i.test(msg)) {
      throw new FatalError(`Auth failure in synthesis: ${msg}`);
    }
    throw new RetryableError(msg, { retryAfter: "2m" });
  }
}

async function notionStep(recap: Recap): Promise<{ url: string }> {
  "use step";
  try {
    return await writeNotionPage(recap);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rate.*limit|429/i.test(msg)) {
      throw new RetryableError(msg, { retryAfter: "30s" });
    }
    throw new FatalError(msg);
  }
}

async function archiveStep(recap: Recap): Promise<{ path: string }> {
  "use step";
  try {
    return await writeArchiveMarkdown(recap);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
  await sendSlackDM(input);
}

async function alertStep(input: {
  phase: "claude" | "slack" | "notion" | "archive" | "unknown";
  message: string;
}): Promise<void> {
  "use step";
  await sendSlackErrorAlert(input).catch(() => {});
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
```

The excerpt above strips the structured-log entry/exit calls on each step for readability. The real file at `lib/workflow.ts` has a `console.log({ event: "step.x.start" })` and `event: "step.x.end"` bracketing every step body. Those logs are what populate the trace view.

Notes:
- `"use workflow"` at the top of the file makes the exported function a WDK workflow.
- Each `"use step"` at the top of a function body makes it a retryable, trace-visible unit of work.
- The five prefetch steps run in parallel via `Promise.all`. They return `Result<T>` shapes so the workflow itself never throws on a single source failure.
- The synthesis step distinguishes `FatalError` (auth issues) from `RetryableError` (anything else). Fatals abort and trigger the Slack error-alert DM.
- Fan-out uses `Promise.allSettled` so Notion failing doesn't stop the archive write and vice versa.

### `lib/sandbox.ts`

```ts
import { Sandbox } from "@vercel/sandbox";
import { RecapSchema, type Recap, RECAP_JSON_SCHEMA } from "./schema";
import { buildDailyRecapPrompt, type PromptContext } from "./prompt";

const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000;

export async function runClaudeInSandbox(ctx: PromptContext): Promise<Recap> {
  const snapshotId = process.env.VERCEL_SANDBOX_SNAPSHOT_ID;
  if (!snapshotId) throw new Error("VERCEL_SANDBOX_SNAPSHOT_ID is not set");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const sandbox = await Sandbox.create({
    ...getSandboxCredentials(),
    source: { type: "snapshot", snapshotId },
    timeout: SANDBOX_TIMEOUT_MS,
  });

  try {
    const prompt = buildDailyRecapPrompt(ctx);

    // Write inputs via shell heredoc — simpler and more reliable than
    // the SDK writeFiles path. Two files: prompt + JSON schema.
    await sandbox.runCommand("sh", [
      "-c",
      [
        `cat > /tmp/prompt.txt <<'DAILYRECAPEOF'\n${prompt}\nDAILYRECAPEOF`,
        `cat > /tmp/schema.json <<'DAILYRECAPEOF'\n${RECAP_JSON_SCHEMA}\nDAILYRECAPEOF`,
      ].join(" && "),
    ]);

    const result = await sandbox.runCommand("sh", [
      "-c",
      `ANTHROPIC_API_KEY='${anthropicKey.replace(/'/g, "'\\''")}' claude ` +
        [
          "--dangerously-skip-permissions",
          "--print",
          "--output-format json",
          '--json-schema "$(cat /tmp/schema.json)"',
          '"$(cat /tmp/prompt.txt)"',
        ].join(" "),
    ]);

    const stdout = await result.stdout();
    const stderr = await result.stderr();

    if (!stdout.trim()) {
      throw new Error(
        `Claude produced no stdout. stderr: ${stderr.slice(0, 500)}`,
      );
    }

    const parsed = JSON.parse(stdout);
    const recapJson = extractRecapJson(parsed);
    return RecapSchema.parse(recapJson);
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

function stripMarkdownJsonFence(s: string): string {
  let t = s.trim();
  if (!t.startsWith("```")) return t;
  t = t.slice(3);
  if (t.toLowerCase().startsWith("json")) {
    t = t.slice(4);
  }
  t = t.trimStart();
  if (t.startsWith("\n")) t = t.slice(1);
  t = t.trimEnd();
  if (t.endsWith("```")) {
    t = t.slice(0, -3).trimEnd();
  }
  return t.trim();
}

function tryParseJsonRecapString(raw: string): unknown | null {
  const stripped = stripMarkdownJsonFence(raw);
  const trimmed = raw.trim();
  const payloads = stripped === trimmed ? [stripped] : [stripped, trimmed];
  for (const payload of payloads) {
    try { return JSON.parse(payload); } catch { /* try next */ }
  }
  return null;
}

function isRecapEnvelope(c: unknown): boolean {
  return c !== null && typeof c === "object" && "sections" in (c as object);
}

function extractRecapJson(parsed: unknown): unknown {
  const root = parsed as Record<string, unknown>;
  const candidates: Array<() => unknown> = [
    () => root.structured_output,
    () => (root.result as Record<string, unknown>)?.structured_output,
    () => {
      const r = root.result;
      if (typeof r === "string") return tryParseJsonRecapString(r);
      return null;
    },
    () => root.result,
    () => root.content,
    () => parsed,
  ];
  for (const get of candidates) {
    try {
      const c = get();
      if (isRecapEnvelope(c)) return c;
    } catch { /* try next */ }
  }
  return parsed;
}

function getSandboxCredentials() {
  if (
    process.env.VERCEL_TOKEN &&
    process.env.VERCEL_TEAM_ID &&
    process.env.VERCEL_PROJECT_ID
  ) {
    return {
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    };
  }
  return {};
}
```

Three things that will bite you here:

1. **File input via heredoc.** The `@vercel/sandbox` SDK has a `writeFiles` method, but piping the prompt and schema via `cat > /tmp/x <<'DAILYRECAPEOF' ... DAILYRECAPEOF` turned out more reliable. The unique heredoc marker avoids collisions with anything in the prompt body.
2. **`--dangerously-skip-permissions` is correct here.** The Sandbox is the security boundary, not Claude's permission prompts. Don't load MCPs.
3. **JSON extraction is defensive.** `claude --output-format json --json-schema ...` wraps the result differently across versions: sometimes `root.structured_output`, sometimes `root.result.structured_output`, sometimes `root.result` as a string wrapped in ` ```json ... ``` ` fences. `extractRecapJson` tries several known paths; `stripMarkdownJsonFence` handles the string-wrapping case that hit me on first deploy.

### `lib/prompt.ts`

The full file is at `lib/prompt.ts` (186 lines). The prompt-template string is the core:

```ts
return `You are Ryan's personal assistant. Today is ${dayOfWeek}, ${date} (${timezone}).

Your job is to produce Ryan's end-of-day recap — a first-person journal entry that captures what actually happened today and sets up tomorrow morning. Written at 6pm tonight; re-read at 7am tomorrow.

## Available sources this run

Available: ${available.join(", ") || "(none)"}
${degraded.length > 0 ? `Degraded: ${degraded.join("; ")}` : "All sources ok."}

## Input data (pre-fetched — do not query external systems)

### Calendar (today's events)
${formatCalendar(sources.calendar)}

### Gmail (threads from the last 24h, de-noised via category filters)
${formatGmail(sources.gmail)}

### Slack (DMs + mentions + your replies today)
${formatSlack(sources.slack)}

### Notion (pages edited today in your workspace)
${formatNotion(sources.notion)}

### GitHub (PRs / issues / reviews you touched today)
${formatGitHub(sources.github)}

## Required output sections

Output a JSON object matching the provided schema with these sections, in this order (natural arc: close today → open tomorrow):

1. **todays_wins** — things that actually moved: decisions made, work shipped, meetings that unlocked something. Not "attended standup" — that's not a win.
2. **commitments_made** — explicit or implicit promises Ryan made today. "I'll send the draft Friday." "I'll intro you." Include who it's to. Pulled from Gmail sent, Slack replies, meeting attendance.
3. **loose_ends** — unanswered emails, DMs without a response, asks Ryan ignored. The guilt pile. Be specific about who's waiting and what they asked.
4. **tomorrow_on_deck** — NOT today's calendar. You don't have tomorrow's calendar in the data here — leave this as an empty array and note in the daily_learning that tomorrow-preview is a v1.5 addition.
5. **front_load_candidates** — admin/quick-win tasks for tomorrow AM. Specific actions, not strategic work.
6. **watch_list** — signals brewing that don't need action today but worth monitoring.
7. **questions_surfaced** — things Ryan encountered today but didn't resolve.
8. **daily_learning** — one-line takeaway worth remembering.

## Voice and tone

- **First person.** "I committed to sending the draft Friday." Never "Ryan committed..." or "You committed..."
- **Ryan's voice.** Direct, concise, lightly wry, zero corporate jargon. Fragments fine. No exclamation marks, no emojis, no motivational pap.
- **Active verbs.** "I shipped X" not "X was shipped."
- **Include links.** Slack permalinks, Gmail thread URLs, Notion page URLs, GitHub PR URLs. Any time you reference a specific artifact, link it.

## Selectivity rules (HARD — never violate)

- SKIP and do not include: login/security notifications, marketing emails, newsletters, automated alerts, subscription confirmations, promotional offers, social media notifications, CI/CD bot messages, "@channel" announcements Ryan didn't engage with, @-mentions in firehose channels where Ryan didn't reply.
- Include only real discussion and real commitments — anything that requires a human response or reflects a decision.
- Slack channel chatter Ryan scrolled past doesn't count. Only DMs, mentions Ryan engaged with, or replies he sent.

## Selectivity rules (SOFT — use judgment)

- Recurring holds / focus blocks / standups with no specific discussion: skip unless something happened.
- "Got it, thanks!" confirmations: skip.
- When uncertain, exclude. A shorter, more selective recap is more valuable than a comprehensive one.
- If a section has nothing genuinely worth reporting, use the "nothing surfaced today" placeholder. Do not pad with filler.

## Length target

~400–600 words total across all sections. Skimmable in 60 seconds.

## TL;DR bullets

After the sections, generate 3–5 short bullets (under 90 chars each) for a Slack DM headline. Most important things only — the items that would make Ryan sit up if he saw nothing else.

## Output format

Return a single JSON object matching the provided schema. No prose before or after — just the JSON.`;
```

The prompt is rebuilt every run with the current date, day, timezone, and the prefetched data inline. No outbound queries happen from inside the Sandbox.

A few decisions worth calling out:
- Every section is required even when empty. Empty sections return the single string `"nothing surfaced today"` so downstream sinks always have something to render.
- The length target is in the prompt. Without it Claude over-writes.
- The HARD/SOFT split makes it easy to tune. HARD rules are things I never want to see (promo, security, CI noise). SOFT rules are judgment calls I'm OK with Claude getting wrong occasionally.

### Prefetch sources — pattern + one example

Every source lives in `lib/sources/<name>.ts` and returns a `Result<T>`:

```ts
type Result<T> = { ok: true; data: T } | { ok: false; reason: string };
```

`lib/sources/calendar.ts` is the simplest example:

```ts
import { google } from "googleapis";
import { getGoogleOAuthClient } from "./google-client";
import { dateToUTCWindow, type DateWindow, type Result } from "./types";

export interface CalendarEvent {
  id: string;
  start: string;
  end: string;
  summary: string;
  attendees: string[];
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
      singleEvents: true,
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
```

The pattern: get an auth client, call the SDK, map the response into a flat shape the prompt formatter can render, catch everything and return `{ ok: false, reason }`. The Gmail / Slack / Notion-reads / GitHub equivalents follow the same shape with the right SDK calls.

### Sinks — pattern + one example

Sinks live in `lib/sinks/<name>.ts`. They take a validated `Recap` and write it somewhere.

`lib/sinks/notion.ts` is the most involved because the Notion DB has a property schema that has to be set up first. The page-creation core is:

```ts
import { Client } from "@notionhq/client";
import type { Recap } from "../schema";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export async function writeNotionPage(
  recap: Recap,
  meta?: { runId?: string },
): Promise<{ url: string; id: string }> {
  const dbId = requireEnv("NOTION_DAILY_BRIEFS_DB_ID");

  const wordCount = countWords(recap);
  const status = recap.sources_degraded.length > 0 ? "Degraded" : "Published";

  const page = await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      Name: { title: [{ text: { content: `Daily Brief — ${recap.day_of_week}, ${recap.date}` } }] },
      Date: { date: { start: recap.date } },
      Day: { select: { name: recap.day_of_week } },
      Status: { select: { name: status } },
      Sources: { multi_select: recap.sources_available.map((s) => ({ name: s })) },
      "Sources Degraded": {
        multi_select: recap.sources_degraded
          .map((s) => s.split(":")[0].trim())
          .filter((s) => ["calendar", "gmail", "slack", "notion", "github"].includes(s))
          .map((name) => ({ name })),
      },
      "Word Count": { number: wordCount },
      "TL;DR Count": { number: recap.tldr_bullets.length },
      Commitments: { number: recap.sections.commitments_made.length },
      "Loose Ends": { number: recap.sections.loose_ends.length },
      ...(meta?.runId ? { "Run ID": { rich_text: [{ text: { content: meta.runId } }] } } : {}),
    },
    children: buildBlocks(recap) as any,
  });

  const url = "url" in page ? (page.url as string) : "";
  return { url, id: page.id };
}
```

The full file (`lib/sinks/notion.ts`, 213 lines) also contains `buildBlocks(recap)` which renders each section as Notion block JSON (headings, bulleted lists, callouts, a degradation warning at top if anything failed).

Required Notion DB properties (names are case-sensitive):
- `Name` (title), `Date` (date), `Day` (select), `Status` (select: Published | Draft | Failed | Degraded)
- `Sources` (multi_select), `Sources Degraded` (multi_select)
- `Word Count`, `TL;DR Count`, `Commitments`, `Loose Ends` (all number)
- `Tags`, `Key People` (multi_select — empty in v1, populated by v1.5 prompt)
- `Run ID` (rich_text)

### `scripts/bake-snapshot.ts`

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Sandbox } from "@vercel/sandbox";

async function main() {
  const setupScript = readFileSync(
    resolve(__dirname, "../snapshot/setup.sh"),
    "utf-8",
  );

  console.log("→ Creating fresh Vercel Sandbox (node24)…");
  const sandbox = await Sandbox.create({
    ...getCredentials(),
    runtime: "node24",
    timeout: 15 * 60 * 1000,
  });
  console.log("✓ Sandbox created");

  try {
    console.log("→ Running snapshot/setup.sh inside the sandbox…");
    const result = await sandbox.runCommand("sh", ["-c", setupScript]);
    const stdout = await result.stdout();
    const stderr = await result.stderr();
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    console.log("✓ Setup complete");

    console.log("→ Taking snapshot…");
    const snapshot = await sandbox.snapshot();
    console.log(`\n✓ Snapshot created: ${snapshot.snapshotId}\n`);
    console.log("Next: set VERCEL_SANDBOX_SNAPSHOT_ID in Vercel env.");
    console.log(
      `  echo "${snapshot.snapshotId}" | vercel env add VERCEL_SANDBOX_SNAPSHOT_ID production`,
    );
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
```

Run with `pnpm run bake-snapshot`. It spins up a fresh node24 Sandbox, runs `snapshot/setup.sh` inside (which installs the Claude Code CLI), takes a snapshot, and prints the `snap_xxx` ID. Paste that into Vercel env as `VERCEL_SANDBOX_SNAPSHOT_ID` for production and development.

Re-bake when Anthropic ships a new Claude Code version or when you want to change what's pre-installed. The bake takes about two minutes. Rolling back is one env var change.

## Environment variables

| Name | Purpose |
|---|---|
| `CRON_SECRET` | Bearer the cron route verifies |
| `ANTHROPIC_API_KEY` | Injected into the Sandbox at runtime, used by `claude` |
| `VERCEL_SANDBOX_SNAPSHOT_ID` | The `snap_xxx` printed by the bake script |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | Calendar + Gmail OAuth |
| `SLACK_BOT_TOKEN` | Slack reads + DM write (v1 uses bot token; search needs user token) |
| `SLACK_USER_ID` | Recipient of the Slack DM |
| `NOTION_TOKEN` / `NOTION_DAILY_BRIEFS_DB_ID` | Notion integration + target DB |
| `GITHUB_TOKEN` | Octokit auth |
| `GITHUB_ARCHIVE_REPO` | `owner/repo` for the private archive |
| `TIMEZONE` | Defaults to `America/Chicago` |

On Vercel deployments, `@vercel/sandbox` auto-authenticates via `VERCEL_OIDC_TOKEN`. Locally you pass `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`.

## Trade-offs and known gaps

- **Boxed in by the Claude Code CLI.** If I ever need a planner/executor pattern with different models at each step, this design doesn't bend without real surgery. For a personal recap, that's a good trade.
- **Snapshot lifecycle.** Re-bake when the CLI updates. One command and two minutes, but it's a step I can forget.
- **Slack reads half-working (v1 gap).** `search.messages` needs a user token (`xoxp-`). Stood up with a bot token; search calls return `not_allowed_token_type` and the Slack section marks itself degraded. The rest of the recap still ships.
- **Tomorrow-on-deck empty (v1 gap).** Calendar prefetch grabs today only. Second window for tomorrow is v1.5.
- **Octokit deprecation.** `search.issuesAndPullRequests` is deprecated. Works today, will break eventually.
- **Key People / Tags multi-selects empty.** The Notion DB has these properties; the prompt doesn't emit them yet. v1.5 prompt change.
- **First-run setup is a lot.** Google OAuth dance, Slack app install, Notion DB schema, GitHub PAT, Vercel env, snapshot bake. `ADMIN_SETUP.md` has the full checklist but it takes 30–60 minutes the first time.
- **Cost.** Claude synthesis is 1–2¢ per run, Sandbox minutes are roughly 1–2¢, everything else is free tiers. ~$0.50–1.00/month at daily cadence.
