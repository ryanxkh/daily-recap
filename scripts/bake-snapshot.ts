/**
 * Bake the Vercel Sandbox snapshot used by the daily recap workflow.
 *
 * Option F architecture: the snapshot is minimal — just Node + Claude Code CLI.
 * No MCPs, no Google auth, no interactive steps. Pure deterministic bake.
 *
 * Usage:
 *   pnpm run bake-snapshot
 *
 * Output:
 *   Prints the snapshot ID (snap_XXX...) to stdout. Paste into Vercel env as
 *   VERCEL_SANDBOX_SNAPSHOT_ID.
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
    timeout: 15 * 60 * 1000, // 15 min for the bake
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
    console.log(
      `  echo "${snapshot.snapshotId}" | vercel env add VERCEL_SANDBOX_SNAPSHOT_ID development`,
    );
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
