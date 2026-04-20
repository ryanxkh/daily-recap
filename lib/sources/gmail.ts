/**
 * Gmail source — list today's threads you actually engaged with.
 *
 * Query strategy:
 *   - Gmail's `newer_than:1d` is simpler than epoch-ms math for this source
 *   - Filter to (sent by me) OR (in Inbox and not promotional/social/updates)
 *   - Hard exclude common noise categories via Gmail's own labels
 *
 * We return lightweight thread summaries — just enough for Claude to pick
 * which ones matter. No full email bodies (too many tokens).
 */

import { google } from "googleapis";
import { getGoogleOAuthClient } from "./google-client";
import type { DateWindow, Result } from "./types";

export interface EmailThreadSummary {
  id: string;
  subject: string;
  from: string;
  to: string;
  snippet: string;
  date: string;            // ISO
  labels: string[];
  isFromMe: boolean;
  link: string;
}

export async function fetchGmail(window: DateWindow): Promise<Result<EmailThreadSummary[]>> {
  try {
    const auth = getGoogleOAuthClient();
    const gmail = google.gmail({ version: "v1", auth });

    // Gmail search syntax. `newer_than` counts backwards from now. For a 6pm
    // trigger, "1d" covers the full day's messages. Category filters cut noise.
    const query = [
      "newer_than:1d",
      "-category:promotions",
      "-category:social",
      "-category:updates",
      "-category:forums",
      "-in:spam",
      "-in:trash",
    ].join(" ");

    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 50,
    });

    const ids = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    if (ids.length === 0) return { ok: true, data: [] };

    // Fetch message metadata in parallel. Gmail API has a 100qps soft limit;
    // 50 parallel calls is comfortable.
    const myEmail = (process.env.GOOGLE_USER_EMAIL ?? "").toLowerCase();
    const threads = await Promise.all(
      ids.map(async (id) => {
        const m = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "To", "Date"],
        });
        const headers = Object.fromEntries(
          (m.data.payload?.headers ?? []).map((h) => [
            (h.name ?? "").toLowerCase(),
            h.value ?? "",
          ]),
        );
        const from = headers.from ?? "";
        const isFromMe =
          !!myEmail && from.toLowerCase().includes(myEmail);

        return {
          id: m.data.id ?? "",
          subject: headers.subject ?? "(no subject)",
          from,
          to: headers.to ?? "",
          snippet: (m.data.snippet ?? "").slice(0, 200),
          date: headers.date ?? "",
          labels: m.data.labelIds ?? [],
          isFromMe,
          link: `https://mail.google.com/mail/u/0/#inbox/${m.data.threadId}`,
        } as EmailThreadSummary;
      }),
    );

    return { ok: true, data: threads };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
