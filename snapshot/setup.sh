#!/usr/bin/env bash
# Commands to run INSIDE a fresh Vercel Sandbox before taking a snapshot.
# Invoked by scripts/bake-snapshot.ts — not run directly.
#
# Option F: the sandbox is minimal. It holds Node + Claude Code CLI. All
# data gathering happens in Vercel Functions BEFORE the sandbox boots, so
# no MCP servers are baked in. The sandbox just runs `claude` against the
# pre-populated prompt.
#
# Amazon Linux 2023 (AL2023) under the hood → use dnf.

set -euo pipefail

echo "[snapshot-setup] cleaning dnf cache"
sudo dnf clean all 2>&1 || true

echo "[snapshot-setup] installing system deps"
sudo dnf install -y --skip-broken \
  git \
  curl \
  ca-certificates \
  2>&1

echo "[snapshot-setup] installing Claude Code CLI"
# Verify current install path at https://github.com/anthropics/claude-code
# before bumping major versions.
npm install -g @anthropic-ai/claude-code

echo "[snapshot-setup] creating Claude config directory"
mkdir -p /root/.claude

echo "[snapshot-setup] verifying installs"
claude --version
node --version

echo "[snapshot-setup] done. Snapshot is ready to be taken."
echo "No MCPs, no Google auth inside the sandbox — data is prefetched by Vercel."
