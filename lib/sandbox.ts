/**
 * Vercel Sandbox — boot + run Claude Code headless.
 *
 * This file exports ONE function: `runClaudeInSandbox`. The whole sandbox
 * lifecycle (boot → write files → run claude → read output → done) happens
 * inside it, because a Sandbox instance is not serializable and cannot be
 * passed between WDK step functions.
 *
 * Auth: on Vercel deployments, @vercel/sandbox auto-authenticates via
 * VERCEL_OIDC_TOKEN (injected by the platform). For local dev we spread
 * VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID into Sandbox.create().
 *
 * TODO day 1:
 *   - Verify `claude --json-schema` flag exists in current CLI; if not,
 *     embed schema in prompt and skip the flag.
 *   - Verify `sandbox.writeFiles(...)` method (docs I have show runCommand
 *     patterns; writeFiles is used in Drew's reference code but may have
 *     moved). If missing, fall back to `runCommand("sh", ["-c", heredoc])`.
 *   - Verify sandbox timeout can be bumped to 15m if needed.
 */

import { Sandbox } from "@vercel/sandbox";
import { RecapSchema, type Recap, RECAP_JSON_SCHEMA } from "./schema";
import { buildDailyRecapPrompt } from "./prompt";

const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

export async function runClaudeInSandbox(params: {
  date: string;
  dayOfWeek: string;
  timezone: string;
}): Promise<Recap> {
  const snapshotId = process.env.VERCEL_SANDBOX_SNAPSHOT_ID;
  if (!snapshotId) {
    throw new Error("VERCEL_SANDBOX_SNAPSHOT_ID is not set");
  }

  console.log(
    JSON.stringify({
      event: "sandbox.boot.start",
      date: params.date,
      snapshotId,
    }),
  );

  const sandbox = await Sandbox.create({
    ...getSandboxCredentials(),
    source: { type: "snapshot", snapshotId },
    timeout: SANDBOX_TIMEOUT_MS,
  });

  console.log(JSON.stringify({ event: "sandbox.boot.complete", date: params.date }));

  try {
    const prompt = buildDailyRecapPrompt(params);

    const mcpConfig = renderMCPConfig({
      notionToken: requireEnv("NOTION_TOKEN"),
      slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
      githubToken: requireEnv("GITHUB_TOKEN"),
    });

    // Write the three input files via a single shell heredoc — more portable
    // than relying on a writeFiles method we haven't yet verified in the
    // current SDK. If writeFiles is available, we'll swap to it.
    await sandbox.runCommand("sh", [
      "-c",
      [
        `mkdir -p /root/.claude`,
        `cat > /tmp/prompt.txt <<'DAILYRECAPEOF'\n${prompt}\nDAILYRECAPEOF`,
        `cat > /tmp/schema.json <<'DAILYRECAPEOF'\n${RECAP_JSON_SCHEMA}\nDAILYRECAPEOF`,
        `cat > /root/.claude/mcp_config.json <<'DAILYRECAPEOF'\n${mcpConfig}\nDAILYRECAPEOF`,
      ].join(" && "),
    ]);

    console.log(JSON.stringify({ event: "claude.run.start", date: params.date }));

    // TODO verify: `--json-schema` flag in current Claude Code CLI.
    // If absent, drop the flag — the schema is already embedded in the prompt
    // and Zod will enforce the shape after parsing.
    const result = await sandbox.runCommand("sh", [
      "-c",
      [
        "claude",
        "--dangerously-skip-permissions",
        "--output-format json",
        '--json-schema "$(cat /tmp/schema.json)"',
        '-p "$(cat /tmp/prompt.txt)"',
      ].join(" "),
    ]);

    const stdout = await result.stdout();
    const stderr = await result.stderr();

    console.log(
      JSON.stringify({
        event: "claude.run.complete",
        date: params.date,
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
      }),
    );

    if (!stdout.trim()) {
      throw new Error(
        `Claude produced no stdout. stderr: ${stderr.slice(0, 500)}`,
      );
    }

    // Claude Code wraps structured output in `structured_output` when
    // `--json-schema` is passed. Adjust if the shape is different.
    const parsed = JSON.parse(stdout);
    const recapJson = parsed.structured_output ?? parsed;
    return RecapSchema.parse(recapJson);
  } finally {
    await sandbox.stop().catch(() => {
      // best-effort cleanup; sandboxes auto-expire on timeout
    });
  }
}

function getSandboxCredentials() {
  // On Vercel, OIDC handles this automatically — return empty object.
  // For local dev, populate via `vercel env pull .env.local`.
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function renderMCPConfig(tokens: {
  notionToken: string;
  slackBotToken: string;
  githubToken: string;
}): string {
  // Claude Code MCP config shape. The MCP server npm packages referenced here
  // must be installed into the snapshot during bake (see snapshot/setup.sh).
  // Gmail + Google Calendar: Claude-managed connectors, authenticated
  // interactively during snapshot bake — nothing configured here.
  return JSON.stringify(
    {
      mcpServers: {
        notion: {
          command: "npx",
          args: ["-y", "@notionhq/notion-mcp-server"],
          env: { NOTION_API_KEY: tokens.notionToken },
        },
        slack: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-slack"],
          env: { SLACK_BOT_TOKEN: tokens.slackBotToken },
        },
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: tokens.githubToken },
        },
      },
    },
    null,
    2,
  );
}
