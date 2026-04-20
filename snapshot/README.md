# Sandbox Snapshot

How to bake the Vercel Sandbox snapshot that every daily run boots from.

The snapshot contains:
- Node.js 24 (LTS)
- Claude Code CLI (pre-installed, globally)
- MCP server binaries (Notion, Slack, GitHub)
- Claude managed-connector authentication for Gmail + Google Calendar (baked in interactively — the auth state persists in `~/.claude/`)
- The tone-of-voice skill (and any other custom skills)

What the snapshot **does not** contain:
- Per-service API tokens (Notion / Slack / GitHub) — injected at runtime via env vars
- Today's prompt or schema — written to `/tmp/` at runtime

## Prerequisites before baking

You must have completed the admin-setup checklist first (see `ADMIN_SETUP.md` at repo root). In particular:
- Anthropic API key for Claude Code
- Vercel team/project linked, `@vercel/sandbox` working locally

## Bake flow (one time, plus re-bake on software updates)

The bake script is interactive — you need to approve the Google managed-connector OAuth in a browser once.

```bash
pnpm run bake-snapshot
```

Under the hood, this script:

1. Creates a fresh Vercel Sandbox with `runtime: "node24"` (no snapshot source)
2. Installs OS deps (`dnf install ...`) and Claude Code CLI globally
3. Installs the MCP server npm packages (`@notionhq/notion-mcp-server`, `@modelcontextprotocol/server-slack`, `@modelcontextprotocol/server-github`)
4. Copies the tone-of-voice skill into `~/.claude/skills/`
5. Runs `claude` once interactively so you can authenticate the Gmail + Google Calendar managed connectors in your browser
6. Calls `sandbox.snapshot()` → returns `snap_XXXXXXXXXXXX`
7. Prints the snapshot ID to paste into Vercel env as `VERCEL_SANDBOX_SNAPSHOT_ID`

## When to re-bake

Re-bake when:
- Claude Code CLI releases a major version you want to pick up
- An MCP server version pin changes
- You want to add or modify a baked-in skill
- A managed-connector session has expired and you need to re-authenticate

Rebaking is slow-ish (5–10 min). Doing it during a known-good development pause is fine.

## Verifying the snapshot works

After baking, the simplest smoke test: manually trigger the cron route.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-deployment>.vercel.app/api/cron/recap
```

Then inspect the run:

```bash
npx workflow inspect run <runId> --backend vercel --project daily-recap
```

Successful run = Slack DM arrives in under 8 minutes.

## Troubleshooting the bake

- **Claude auth flow never opens** — interactive sandbox commands require a TTY; ensure the bake script uses `{ stdio: "inherit" }` when calling `runCommand`.
- **MCP install fails** — some MCP server packages have peer deps that need extra OS libraries. Adjust `snapshot/setup.sh` accordingly.
- **Managed connector auth doesn't persist** — means the auth state lives outside `~/.claude/` (e.g. in an OS keychain). Fall back to custom OAuth for Google.
