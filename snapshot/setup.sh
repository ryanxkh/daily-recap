#!/usr/bin/env bash
# Commands to run INSIDE a fresh Vercel Sandbox before taking a snapshot.
# Invoked by scripts/bake-snapshot.ts — not run directly.
#
# Amazon Linux 2023 (AL2023) under the hood → use dnf.

set -euo pipefail

echo "[snapshot-setup] cleaning dnf cache"
sudo dnf clean all 2>&1 || true

echo "[snapshot-setup] installing system deps"
# Most of these are for general Node/native-module builds; expand only as needed.
sudo dnf install -y --skip-broken \
  git \
  curl \
  ca-certificates \
  python3 \
  gcc-c++ \
  make \
  2>&1

echo "[snapshot-setup] installing Claude Code CLI"
# The CLI name may evolve; check https://github.com/anthropics/claude-code for the
# current install path before baking.
npm install -g @anthropic-ai/claude-code

echo "[snapshot-setup] installing MCP server packages"
npm install -g \
  @notionhq/notion-mcp-server \
  @modelcontextprotocol/server-slack \
  @modelcontextprotocol/server-github

echo "[snapshot-setup] creating Claude config directory"
mkdir -p /root/.claude/skills
mkdir -p /root/.claude/mcp

echo "[snapshot-setup] verifying installs"
claude --version || echo "WARN: claude CLI not found on PATH"
node --version

echo "[snapshot-setup] done. Next step: interactive Claude auth for Google managed connectors."
echo "The bake script will now prompt you to authenticate Gmail + Google Calendar."
