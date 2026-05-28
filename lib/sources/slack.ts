/**
 * Slack source — DMs to you and messages where you were mentioned today.
 *
 * Uses Slack Search API (`search.messages`). Slack REQUIRES a USER token
 * (xoxp-) for this endpoint — bot tokens are rejected with
 * `not_allowed_token_type`. Configure `search:read` under User Token Scopes
 * in your Slack app, install/reinstall to the workspace, and set the
 * resulting xoxp- token as SLACK_USER_TOKEN. We keep SLACK_BOT_TOKEN as a
 * fallback for clarity in error messages but the search call will fail
 * against a bot token.
 */

import { WebClient } from "@slack/web-api";
import { dateToUTCWindow, type DateWindow, type Result } from "./types";

export interface SlackMessageSummary {
  ts: string;                 // Slack message timestamp (also used as permalink anchor)
  channelName: string;
  channelId: string;
  fromUserId: string;
  fromUserName: string;
  text: string;
  permalink: string;
  isDM: boolean;
  isMention: boolean;
}

export async function fetchSlack(window: DateWindow): Promise<Result<SlackMessageSummary[]>> {
  try {
    // Prefer the user token (required by search.messages); fall back to the
    // bot token only so we surface a clearer reason when neither is set.
    const token = process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN;
    const userId = process.env.SLACK_USER_ID;
    if (!token || !userId) {
      return { ok: false, reason: "SLACK_USER_TOKEN/SLACK_BOT_TOKEN or SLACK_USER_ID missing" };
    }
    if (!token.startsWith("xoxp-")) {
      return {
        ok: false,
        reason:
          "Slack search.messages requires a user token (xoxp-). Set SLACK_USER_TOKEN with search:read scope.",
      };
    }

    const slack = new WebClient(token);
    const { startMs, endMs } = dateToUTCWindow(window);
    // Slack search supports `after:YYYY-MM-DD` / `before:` operators.
    const dateStr = window.date;
    const queries = [
      `to:<@${userId}> after:${dateStr}`,        // DMs to you
      `from:<@${userId}> after:${dateStr}`,      // your replies
      `<@${userId}> after:${dateStr}`,            // mentions anywhere the bot can see
    ];

    const allMatches = new Map<string, SlackMessageSummary>();
    for (const q of queries) {
      const res = await slack.search.messages({ query: q, count: 30 });
      const matches = res.messages?.matches ?? [];
      for (const m of matches) {
        const ts = m.ts ?? "";
        if (!ts) continue;
        const msMs = Math.floor(Number(ts) * 1000);
        if (msMs < startMs || msMs >= endMs) continue;
        if (allMatches.has(ts)) continue;

        allMatches.set(ts, {
          ts,
          channelName: m.channel?.name ?? "dm",
          channelId: m.channel?.id ?? "",
          fromUserId: m.user ?? "",
          fromUserName: m.username ?? "",
          text: (m.text ?? "").slice(0, 400),
          permalink: m.permalink ?? "",
          isDM: m.channel?.name?.startsWith("D") === true || m.channel?.is_im === true,
          isMention: !!m.text?.includes(`<@${userId}>`),
        });
      }
    }

    return { ok: true, data: Array.from(allMatches.values()) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
