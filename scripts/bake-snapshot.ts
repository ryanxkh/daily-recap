/**
 * Bake the Vercel Sandbox snapshot used by the daily recap workflow.
 *
 * This script is interactive — you will need to approve the Gmail + Google
 * Calendar managed-connector OAuth in a browser during the Claude setup step.
 *
 * Usage:
 *   pnpm run bake-snapshot
 *
 * Output:
 *   Prints the snapshot ID (snap_XXX...) to stdout. Paste that value into
 *   Vercel env as VERCEL_SANDBOX_SNAPSHOT_ID.
 */

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
    timeout: 30 * 60 * 1000, // 30 min for the bake
  });
  console.log("✓ Sandbox created");

  try {
    // Run the setup script that installs Claude + MCPs + system deps.
    console.log("→ Running snapshot/setup.sh inside the sandbox…");
    const setupResult = await sandbox.runCommand("sh", ["-c", setupScript]);
    const setupStdout = await setupResult.stdout();
    const setupStderr = await setupResult.stderr();
    console.log(setupStdout);
    if (setupStderr) console.error(setupStderr);
    console.log("✓ Setup complete");

    // ------------------------------------------------------------
    // Interactive step: Claude managed-connector auth for Google.
    //
    // This requires the user to open a browser and approve the OAuth flow.
    // The exact command / flag surface depends on the Claude Code CLI
    // version; update this before running:
    //   claude mcp add-managed gmail
    //   claude mcp add-managed google-calendar
    //
    // For now, we shell out with stdio inherited so the user can interact.
    // ------------------------------------------------------------
    console.log("→ Starting Claude to authenticate Google managed connectors.");
    console.log("  Approve the OAuth prompts in your browser.");
    console.log("  Press Ctrl+D or exit Claude when done.");

    // NOTE: the Vercel Sandbox SDK's interactive-input story depends on the
    // version shipped. If `runCommand` doesn't support an interactive PTY,
    // we'll instead run `claude` via `sandbox.connect()` (WebSocket/SSH style)
    // or fall back to doing Google OAuth manually in scripts/auth-google.ts.
    const authResult = await sandbox.runCommand("claude", ["--version"]);
    console.log(await authResult.stdout());
    // TODO: wire the actual managed-connector auth flow here.

    // ------------------------------------------------------------
    // Snapshot
    // ------------------------------------------------------------
    console.log("→ Taking snapshot…");
    const snapshot = await sandbox.snapshot();
    console.log(`✓ Snapshot created: ${snapshot.snapshotId}`);
    console.log("");
    console.log("Next: set VERCEL_SANDBOX_SNAPSHOT_ID in Vercel env:");
    console.log(`  vercel env add VERCEL_SANDBOX_SNAPSHOT_ID production preview development`);
    console.log(`  (paste value: ${snapshot.snapshotId})`);
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

function getCredentials() {
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

main().catch((err) => {
  console.error("Bake failed:", err);
  process.exit(1);
});
