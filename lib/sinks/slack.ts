/**
 * Slack sink — DMs Ryan a TL;DR of the recap with a link to the Notion page.
 *
 * Two entry points:
 *   - sendSlackDM          — normal success path with TL;DR bullets
 *   - sendSlackErrorAlert  — failure path with phase + error detail
 *
 * Both DM Ryan directly using his Slack user ID (SLACK_USER_ID). The bot needs
 * the `chat:write` scope and `im:write` if using user-ID targeting.
 */

import { WebClient } from "@slack/web-api";
import type { Recap } from "../schema";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function sendSlackDM(input: {
  recap: Recap;
  notionUrl?: string;
  notionFailed: boolean;
  archiveFailed: boolean;
}): Promise<void> {
  const userId = requireEnv("SLACK_USER_ID");
  const { recap, notionUrl, notionFailed, archiveFailed } = input;

  const headline = `*Daily brief — ${recap.day_of_week}, ${recap.date}*`;
  const bullets = recap.tldr_bullets.map((b) => `• ${b}`).join("\n");

  const degradedNote =
    recap.sources_degraded.length > 0
      ? `_⚠️ Degraded sources: ${recap.sources_degraded.join("; ")}_\n\n`
      : "";

  const sinkIssues: string[] = [];
  if (notionFailed) sinkIssues.push("Notion write failed — no link available");
  if (archiveFailed) sinkIssues.push("Archive commit failed");
  const sinkNote = sinkIssues.length > 0 ? `\n_${sinkIssues.join(" · ")}_` : "";

  const linkLine = notionUrl ? `\n<${notionUrl}|→ Open full recap in Notion>` : "";

  const text = `${headline}\n${degradedNote}${bullets}${linkLine}${sinkNote}`;

  await slack.chat.postMessage({
    channel: userId, // user IDs work as DM channels in Slack's API
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
}

export async function sendSlackErrorAlert(input: {
  phase: string;
  message: string;
}): Promise<void> {
  const userId = process.env.SLACK_USER_ID;
  if (!userId) return; // best-effort; if Slack itself is down, fall back to WDK logs

  const truncated = input.message.slice(0, 400);

  const text = [
    `:warning: *Daily recap failed* — phase: \`${input.phase}\``,
    "```",
    truncated,
    "```",
    "_Inspect the run:_ `npx workflow inspect runs --backend vercel --project daily-recap`",
  ].join("\n");

  try {
    await slack.chat.postMessage({
      channel: userId,
      text,
      unfurl_links: false,
    });
  } catch {
    // Swallow — we don't want alerting to mask the original error.
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
