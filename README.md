# Daily Recap Agent

A personal end-of-day recap agent running on Vercel. Every day at 6pm CT, Vercel Cron triggers a Vercel Workflow that boots a Vercel Sandbox with Claude Code pre-installed, which autonomously reads my Google Calendar, Gmail, Slack, Notion, and GitHub activity for the day and synthesizes a first-person recap into:

- A rich **Notion page** in a `Daily Briefs` database (reading surface)
- A **markdown file** committed to a private archive repo (long-term log)
- A **Slack DM** with a TL;DR and link to the Notion page (push notification)

Inspired by [Drew's "Claude Code as a Cron Job"](https://drew.tech/posts/claude-code-as-a-cron-job) — adapted for my tool stack (Notion-native, Vercel-native, multi-sink fan-out).

## What this repo is

- **Public code, private content.** The code, infra, and decisions are public. The actual daily recaps live in a separate private archive repo.
- **A build-in-public companion artifact.** See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the narrative, [`decisions.md`](./decisions.md) for the running decision log, and [`costs.md`](./costs.md) for what this actually costs to run.

## Stack

- **Next.js** (App Router) — the tiny Next app holds the cron route and workflow definitions
- **Vercel Cron** — schedule trigger
- **Vercel Workflow (WDK)** — durable, step-based orchestration with retries
- **Vercel Sandbox** — Firecracker microVM running Claude Code (booted from a pre-baked snapshot)
- **Claude Code CLI** (headless) — the agent itself, invoked with `--print --output-format json --json-schema`
- **Sources** (prefetch, in Vercel Functions): `googleapis` (Gmail + Calendar), `@slack/web-api`, `@notionhq/client`, `@octokit/rest`
- **Sinks** (fan-out, in Vercel Functions): `@notionhq/client`, `@octokit/rest`, `@slack/web-api`
- **Zod** — output schema validation

## Architecture at a glance

```
Vercel Cron (6pm CT)
  → /api/cron/recap (Next.js)
    → start(dailyRecapWorkflow)
      → Promise.all([
          [step] prefetchCalendar()   ← googleapis
          [step] prefetchGmail()      ← googleapis
          [step] prefetchSlack()      ← @slack/web-api
          [step] prefetchNotion()     ← @notionhq/client
          [step] prefetchGitHub()     ← @octokit/rest
        ])
      → [step] synthesizeStep()
          - boot sandbox from snap_...
          - write prompt + JSON schema to /tmp via heredoc
          - run: claude --print --output-format json --json-schema ...
          - strip markdown fences, zod-validate into Recap
      → Promise.allSettled([
          [step] writeNotionPage(recap),
          [step] writeArchiveMarkdown(recap),
        ])
      → [step] sendSlackDM(recap, notionUrl)
      → [step] logRunMetadata(recap)
```

## Local dev

```bash
pnpm install
cp .env.example .env.local  # fill in tokens
pnpm dev
```

## Deployment

```bash
vercel link
vercel env pull
vercel deploy
```

Manual trigger (to test without waiting for 6pm):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-deployment>.vercel.app/api/cron/recap
```

## Status

🚧 **Building** — see [`decisions.md`](./decisions.md) for current state and the day-by-day log.
