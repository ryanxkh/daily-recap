# Sandbox Snapshot

How to bake the Vercel Sandbox snapshot that every daily run boots from.

## What's in the snapshot (Option F architecture)

The snapshot is intentionally minimal:
- Node.js 24 (LTS)
- Claude Code CLI (pre-installed, globally)
- Empty `/root/.claude/` directory

**What the snapshot does NOT contain:**
- MCP server binaries (not needed — data is prefetched in Vercel Functions)
- Google OAuth state (not needed — Google data comes pre-fetched)
- Per-service API tokens (Notion, Slack, GitHub) — these are also used in Vercel Functions, not inside the sandbox
- The Anthropic API key — injected at runtime via env var

Design note: Option F moved all data gathering into Vercel Functions using
official SDKs (`googleapis`, `@slack/web-api`, `@notionhq/client`, `@octokit/rest`).
The sandbox's only job is to run Claude against a prompt that already contains
all source data. This makes the snapshot trivial to bake and rebake.

## Prerequisites before baking

- Anthropic API key available in your shell as `ANTHROPIC_API_KEY`
- Vercel project linked (`.vercel/project.json` present)
- `@vercel/sandbox` accessible from your Vercel plan

## Bake flow

```bash
pnpm run bake-snapshot
```

The script:
1. Creates a fresh sandbox with `runtime: "node24"` (no snapshot source)
2. Runs `snapshot/setup.sh` inside — installs system deps + Claude CLI
3. Verifies `claude --version` prints successfully
4. Calls `sandbox.snapshot()` → returns `snap_XXXX...`
5. Prints the snapshot ID to paste into Vercel env as `VERCEL_SANDBOX_SNAPSHOT_ID`

Expected bake time: ~3-5 minutes.

## When to re-bake

- New Claude Code CLI major version you want to pick up
- Claude Code CLI argument changes that affect the sandbox invocation
- Infrequent — probably once a quarter at most

## Verifying the snapshot

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<deployment>.vercel.app/api/cron/recap
```

Then inspect:

```bash
npx workflow inspect runs --backend vercel --project daily-recap
```

Success = Slack DM arrives in under 8 minutes.
