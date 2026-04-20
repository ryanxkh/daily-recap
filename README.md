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
- **Vercel Sandbox** — ephemeral Firecracker microVM running Claude Code
- **Claude Code CLI** (headless) — the agent itself, invoked with `-p` and a JSON schema
- **MCP servers** (inside sandbox): Claude managed Gmail + Calendar connectors, Notion, Slack, GitHub
- **Sinks** (outside sandbox, from workflow steps): `@notionhq/client`, `@octokit/rest`, `@slack/web-api`
- **Zod** — output schema validation

## Architecture at a glance

```
Vercel Cron (6pm CT)
  → /api/cron/recap (Next.js)
    → start(dailyRecapWorkflow)
      → [step] runClaudeInSandbox()
          - boot sandbox from snap_...
          - inject MCP tokens from env
          - run: claude -p --output-format json
          - return parsed recap JSON
      → Promise.all([
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
