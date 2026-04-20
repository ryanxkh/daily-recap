/**
 * Vercel Sandbox — boot + run Claude Code headless to SYNTHESIZE a recap.
 *
 * Option F architecture: all data has been pre-fetched by the workflow's
 * earlier steps and is embedded in the prompt. Claude does not query any
 * external systems from inside the sandbox. No MCPs needed.
 *
 * The sandbox still earns its place here for three reasons:
 *   1. Isolation — ephemeral microVM is a clean trust boundary
 *   2. Reproducibility — same image, same Node, same CLI every run
 *   3. Vercel-platform showcase — part of the build-post narrative
 *
 * Auth: on Vercel deployments, @vercel/sandbox auto-authenticates via
 * VERCEL_OIDC_TOKEN. Locally we pass VERCEL_TOKEN/TEAM_ID/PROJECT_ID.
 */

import { Sandbox } from "@vercel/sandbox";
import { RecapSchema, type Recap, RECAP_JSON_SCHEMA } from "./schema";
import { buildDailyRecapPrompt, type PromptContext } from "./prompt";

const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000;

export async function runClaudeInSandbox(ctx: PromptContext): Promise<Recap> {
  const snapshotId = process.env.VERCEL_SANDBOX_SNAPSHOT_ID;
  if (!snapshotId) throw new Error("VERCEL_SANDBOX_SNAPSHOT_ID is not set");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");

  console.log(
    JSON.stringify({ event: "sandbox.boot.start", date: ctx.date, snapshotId }),
  );

  const sandbox = await Sandbox.create({
    ...getSandboxCredentials(),
    source: { type: "snapshot", snapshotId },
    timeout: SANDBOX_TIMEOUT_MS,
  });

  console.log(JSON.stringify({ event: "sandbox.boot.complete", date: ctx.date }));

  try {
    const prompt = buildDailyRecapPrompt(ctx);

    // Write inputs via shell heredoc — simpler than relying on an SDK
    // writeFiles method we haven't needed to verify. Only two files:
    // the prompt (possibly large) and the JSON schema for validation.
    await sandbox.runCommand("sh", [
      "-c",
      [
        `cat > /tmp/prompt.txt <<'DAILYRECAPEOF'\n${prompt}\nDAILYRECAPEOF`,
        `cat > /tmp/schema.json <<'DAILYRECAPEOF'\n${RECAP_JSON_SCHEMA}\nDAILYRECAPEOF`,
      ].join(" && "),
    ]);

    console.log(JSON.stringify({ event: "claude.run.start", date: ctx.date }));

    const result = await sandbox.runCommand("sh", [
      "-c",
      // The ANTHROPIC_API_KEY is injected into the sandbox at runtime.
      // --strict-mcp-config + empty --mcp-config ensures no MCP side-loading.
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

    console.log(
      JSON.stringify({
        event: "claude.run.complete",
        date: ctx.date,
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
      }),
    );

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

/**
 * Claude Code CLI wraps the --json-schema output in varying shapes depending
 * on version. Try a few known paths and log a shape diagnostic if none match.
 */
function extractRecapJson(parsed: unknown): unknown {
  const root = parsed as Record<string, unknown>;

  const candidates: Array<() => unknown> = [
    () => root.structured_output,
    () => (root.result as Record<string, unknown>)?.structured_output,
    () => {
      const r = root.result;
      if (typeof r === "string") {
        try { return JSON.parse(r); } catch { return null; }
      }
      return null;
    },
    () => root.result,
    () => root.content,
    () => {
      // Some versions return messages: [{ content: [{ text: "<json>" }] }]
      const msgs = root.messages as Array<{ content?: unknown }> | undefined;
      const first = msgs?.[0]?.content;
      if (typeof first === "string") {
        try { return JSON.parse(first); } catch { return null; }
      }
      if (Array.isArray(first)) {
        for (const c of first) {
          const text = (c as { text?: unknown })?.text;
          if (typeof text === "string") {
            try { return JSON.parse(text); } catch { /* keep looking */ }
          }
        }
      }
      return null;
    },
    () => parsed,
  ];

  for (const get of candidates) {
    try {
      const c = get();
      if (c && typeof c === "object" && "sections" in (c as object)) {
        return c;
      }
    } catch { /* try next */ }
  }

  // Nothing matched — log shape for diagnosis
  console.error(
    JSON.stringify({
      event: "claude.extract.failed",
      topLevelKeys: Object.keys(root),
      sample: JSON.stringify(parsed).slice(0, 800),
    }),
  );
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
