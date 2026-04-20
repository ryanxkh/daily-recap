# Architecture

A narrative walkthrough of how this daily recap agent is built, why each piece exists, and what alternatives were considered. Written to double as source material for a writeup — so expect more "why" than a typical spec doc.

---

## The job-to-be-done

An **end-of-day capture that naturally becomes tomorrow's morning brief.** Written at 6pm in my voice, read at 7am. One artifact, two reading moments:

- **Last thing before closing the laptop** — what did I actually do today, what did I commit to, what's loose?
- **First thing on my phone tomorrow** — what's on deck, what fires overnight, what do I owe people, what admin should I front-load?

Secondary use: the daily log compounds into a searchable personal record — useful for weekly reviews, annual retros, and (eventually) pattern detection across weeks.

## The inspiration

[Drew Bredvick's "Claude Code as a Cron Job"](https://drew.tech/posts/claude-code-as-a-cron-job) showed the pattern: a cron-triggered Vercel Sandbox boots a snapshot pre-configured with Claude Code + MCP servers, runs Claude headless with a plain-English prompt, and writes the output to a sink. ~200 lines of code bridges a manual workflow into a fully automated daily task.

This project adapts that pattern with three changes:

1. **Multi-sink fan-out** (Notion + GitHub archive + Slack DM) instead of a single Reflect note
2. **Vercel Workflow (WDK)** for durable step-based execution, so an individual sink failure doesn't require re-running Claude
3. **Claude's managed OAuth connectors** for Gmail + Google Calendar — eliminates writing custom OAuth refresh-token logic

## High-level architecture (Option F, current)

```
┌─────────────────────┐
│ Vercel Cron         │  schedule: 0 23 * * *  UTC
│ (0 23 * * * UTC)    │  = 6pm CDT / 5pm CST
└──────────┬──────────┘
           │ GET /api/cron/recap
           ▼
┌─────────────────────┐
│ Next.js API route   │  validates CRON_SECRET
│ app/api/cron/recap  │  calls start(dailyRecapWorkflow)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Vercel Workflow — dailyRecapWorkflow                                 │
│                                                                      │
│   Step 1: parallel prefetch (5 "use step" functions in Promise.all)  │
│     • fetchCalendar()       ← googleapis SDK + refresh token         │
│     • fetchGmail()          ← googleapis SDK + refresh token         │
│     • fetchSlack()          ← @slack/web-api + bot token             │
│     • fetchNotionEdits()    ← @notionhq/client + integration secret  │
│     • fetchGitHub()         ← @octokit/rest + PAT                    │
│     Each returns Result<T> = {ok: true, data} or {ok: false, reason} │
│                                                                      │
│   Step 2: synthesizeStep(ctx)                                        │
│     - Boots Vercel Sandbox from minimal snapshot (just Claude CLI)   │
│     - Writes prompt (with prefetched data embedded) + JSON schema    │
│     - Runs: claude --print --output-format json --json-schema ...    │
│     - NO MCP calls from inside the sandbox — pure synthesis          │
│     - Returns Zod-validated Recap object                             │
│                                                                      │
│   Steps 3-4 (parallel): Promise.allSettled([                         │
│     writeNotionPage(recap)      → Daily Briefs DB                    │
│     writeArchiveMarkdown(recap) → private recap archive              │
│   ])                                                                  │
│                                                                      │
│   Step 5: sendSlackDM(recap, notionUrl)                              │
│     - TL;DR bullets + link to Notion page                            │
│                                                                      │
│   Step 6: logRunMetadata(recap)                                      │
│     - WDK run metadata (built-in via `npx workflow web`)             │
└─────────────────────────────────────────────────────────────────────┘
```

### The Option F pivot

The original architecture had Claude Code inside the sandbox calling MCP servers to gather data. That broke when we discovered Claude Code CLI v2.1.114 has no managed-connector surface for Google services — the managed connectors we saw in the session at boot (`mcp__claude_ai_Gmail__*`) belong to Claude.ai / Claude API, not the CLI.

Rather than wire up community Google MCPs with custom OAuth *inside* the sandbox, we pushed all data gathering OUT of the sandbox and into Vercel Functions using official SDKs. The sandbox now only does synthesis. See `decisions.md` D15 for the full reasoning.

**Why this is architecturally better anyway:**
- Debuggable: `curl /api/sources/calendar/today` returns raw data directly
- Deterministic: no agentic exploration chaos
- Showcases Vercel: every Vercel primitive is in scope (Functions, Workflow, Sandbox, Cron, env, OIDC, Git-deploy)
- Simpler snapshot: nothing to bake except Claude CLI itself

## The two execution seams (updated for Option F)

1. **Vercel serverless (workflow host)** — the Next.js app. Runs the cron route, hosts the WDK workflow definitions, runs all step functions with full Node.js access. **Every external API call happens here** — both source reads (Gmail, Calendar, Slack, Notion, GitHub) and sink writes (Notion page, archive repo, Slack DM).
2. **Vercel Sandbox (Claude host)** — a Firecracker microVM booted per run from a minimal pre-baked snapshot. Runs Claude Code headless with the prompt. **Does not call any external API.** Pure synthesis of the data embedded in its prompt.

**Key design principle:** **Claude synthesizes; Vercel integrates.** All API complexity (OAuth refresh, retries, rate limits, auth rotation) stays in our code where we control it. Claude only does what it's genuinely good at — turning structured data into structured prose.

## Why Vercel Workflow (WDK)

The multi-sink fan-out is where WDK earns its keep. Three separate external writes (Notion, GitHub, Slack), each with independent failure modes. Without durable execution, one transient Slack API 500 means either:
- Re-run the whole pipeline (expensive — Claude run takes minutes)
- Accept data loss for that day

With WDK, each step's result is cached. If Slack fails at step 4, we retry just step 4 with the already-computed recap from step 1. The Claude call doesn't re-run.

The WDK primitives used:
- `"use workflow"` directive on the orchestrator function
- `"use step"` directive on each sub-function (sandbox call, Notion write, GitHub write, Slack DM, logging)
- `FatalError` for permanent failures (e.g., bad auth token — retrying won't help)
- `RetryableError` for transient failures (e.g., 429 rate limits)

Observability comes free: `npx workflow web <run_id>` gives a visual dashboard of run history, step timings, and retry behavior. We don't need a custom status page for v1.

## Why Vercel Sandbox + snapshot

Claude Code in a sandbox gives us:
- **Isolation** — `--dangerously-skip-permissions` is safe because the VM is ephemeral and has no standing access to anything
- **Predictable environment** — same Node version, same MCP binaries, same shell every run
- **Fast cold starts** — snapshots boot in seconds, not minutes

The snapshot holds:
- OS + Node + Claude Code CLI
- MCP server binaries (installed via `npm install -g ...`)
- Authenticated Claude session (for Google managed connectors)
- Custom skills (e.g., tone-of-voice skill)

The snapshot does **not** hold:
- Per-run tokens (Slack, Notion, GitHub) — those are env-var injected at boot
- Per-run prompts/dates — those are written to `/tmp` at boot

This split lets us rotate credentials without rebaking the snapshot (fast) and update software by rebaking (slow, but rare).

## Auth model — the key simplification

The single biggest friction-reduction came from a late-breaking insight: **Claude has managed MCP connectors for Google services** that handle the entire OAuth lifecycle.

Auth mechanism by source:

| Source | Mechanism | Expires? | Setup friction |
|---|---|---|---|
| **Gmail** | Claude managed connector | Anthropic handles refresh | ~1 min (one-click browser auth) |
| **Google Calendar** | Claude managed connector | Anthropic handles refresh | ~1 min (one-click browser auth) |
| **Notion** | Internal integration secret | Never | ~5 min (create integration, share DB) |
| **Slack** | Bot token (`xoxb-...`) | Never unless rotated | ~10 min (create app, install to workspace) |
| **GitHub** | Fine-grained PAT | Configurable (1 year / never) | ~5 min (scope to archive repo only) |

The Claude managed-connector approach eliminates ~2 hours of writing and testing OAuth 2.0 refresh-token helper scripts for Google. Instead of wrangling `client_id` / `client_secret` / `refresh_token` / token endpoint URLs, we click a button. Anthropic holds the tokens and refreshes them silently.

**Caveat (to verify day 1):** managed connectors need to work headless after the one-time interactive auth. The snapshot-bake flow is:
1. Spin up a sandbox interactively
2. Install Claude Code
3. Run `claude` — opens managed-connector auth in a browser; approve once
4. Authenticated state persists in `~/.claude/`
5. Snapshot the sandbox
6. Every cron run boots this pre-authenticated state

If headless use turns out to require re-confirm per run, we fall back to custom OAuth for Google. The rest of the architecture is unchanged.

## Output schema

The recap is a structured JSON object validated with Zod. Drives both the Notion page template and the markdown archive format.

```ts
const RecapSchema = z.object({
  date: z.string(),                    // "2026-04-20"
  day_of_week: z.string(),             // "Monday"
  sources_available: z.array(z.enum([
    "calendar", "gmail", "slack", "notion", "github"
  ])),
  sources_degraded: z.array(z.string()),  // sources that failed
  sections: z.object({
    todays_wins: z.array(z.string()),
    commitments_made: z.array(z.string()),
    loose_ends: z.array(z.string()),
    tomorrow_on_deck: z.array(z.object({
      meeting: z.string(),
      prep_note: z.string(),
    })),
    front_load_candidates: z.array(z.string()),
    watch_list: z.array(z.string()),
    questions_surfaced: z.array(z.string()),
    daily_learning: z.string(),
  }),
  tldr_bullets: z.array(z.string()).min(3).max(5),
});
```

Voice: first person ("I committed to sending the draft Friday"). Tone: my voice, via the tone-of-voice skill baked into the snapshot. Empty sections get the placeholder `"nothing surfaced today"` rather than being dropped (consistent structure across days).

## Selectivity rules (baked into the prompt)

Explicit exclusions that shape what the agent filters out:
- **Bot/automation noise** — CI notifications, marketing newsletters, digest emails, bot-posted Slack messages
- **Channel chatter I scrolled past** — only Slack messages where I was @-mentioned, DMed, or replied

Soft filters (agent uses judgment):
- Recurring calendar holds/focus blocks with no actual discussion → skip unless something happened
- Routine confirmations ("got it, thanks!") → skip

The goal: 8 sections, ~400–600 words total, skimmable in 60 seconds.

## Failure modes

**Token expiry** (rare with long-lived tokens, but inevitable over months):
- Workflow step catches auth-related error
- Throws `FatalError` (no retry — retrying a bad token doesn't help)
- Slack DM notifies me with which source failed
- I run the local auth helper, paste the new token into Vercel env vars
- Manually trigger the cron URL to re-run today's recap

**Single-MCP outage** (Gmail API 500s for 20 minutes):
- Agent prompt instructs: continue with available sources, note degraded ones at top of recap
- Output schema includes `sources_degraded: []` field
- Recap still publishes — just with a visible "⚠ Gmail unavailable today" note

**Sandbox timeout** (Claude takes >10 min):
- WDK surfaces the timeout in step metadata
- Prompt is hardened with "make a plan, execute ≤20 tool calls, stop"
- Fallback: bump sandbox timeout to 15 min

**Complete workflow failure:**
- Final step catches any unhandled error → emits a different Slack DM with error detail + WDK run URL for inspection

## Observability

v1 uses WDK's built-in tooling — no custom dashboard:
- `npx workflow web` — visual run history
- `npx workflow inspect runs --backend vercel --project daily-recap` — CLI queries
- Slack DMs for success (with recap TL;DR) and failure (with diagnostic)

If a custom `/status` page proves useful later (e.g., for a public demo), we'll add it as v1.5.

## Cost model

See [`costs.md`](./costs.md) for live tracking. Rough v1 estimates:

- Vercel Hobby/Pro: existing account
- Vercel Sandbox: per-second metered (~few cents per run)
- Anthropic API (Claude Code): ~$0.10–$0.50 per run depending on tool-call volume
- Upstash/Marketplace: none for v1 (dropped KV)

Target: **under $5/month** for daily runs.

## Open questions / v1.5+

- WhatsApp signal (deferred — no clean MCP path yet)
- Custom `/status` page for blog-post demo
- Weekly roll-up agent that synthesizes the daily recaps into a Friday review
- Historical pattern detection (e.g., "you've been saying you'll 'circle back' with X for 3 weeks")
- DST-aware cron (minor — manual flip twice a year is fine)
