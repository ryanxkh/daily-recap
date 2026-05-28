/**
 * Prompt builder for the daily recap agent.
 *
 * In Option F (the current architecture), data is prefetched by Vercel
 * Functions and passed INTO this prompt as structured context. Claude's
 * job is synthesis + selectivity, not data gathering.
 *
 * This file is the single most important piece of prompt engineering in
 * the system. Expect to iterate on the filter rules over the first
 * 1-2 weeks of real runs.
 */

import type { CalendarEvent } from "./sources/calendar";
import type { EmailThreadSummary } from "./sources/gmail";
import type { SlackMessageSummary } from "./sources/slack";
import type { NotionPageSummary } from "./sources/notion-reads";
import type { GitHubActivityItem } from "./sources/github-reads";

export interface PromptContext {
  date: string;
  dayOfWeek: string;
  timezone: string;
  sources: {
    calendar: { ok: boolean; data?: CalendarEvent[]; reason?: string };
    gmail: { ok: boolean; data?: EmailThreadSummary[]; reason?: string };
    slack: { ok: boolean; data?: SlackMessageSummary[]; reason?: string };
    notion: { ok: boolean; data?: NotionPageSummary[]; reason?: string };
    github: { ok: boolean; data?: GitHubActivityItem[]; reason?: string };
  };
}

export function buildDailyRecapPrompt(ctx: PromptContext): string {
  const { date, dayOfWeek, timezone, sources } = ctx;

  const degraded: string[] = [];
  if (!sources.calendar.ok) degraded.push(`calendar: ${sources.calendar.reason}`);
  if (!sources.gmail.ok) degraded.push(`gmail: ${sources.gmail.reason}`);
  if (!sources.slack.ok) degraded.push(`slack: ${sources.slack.reason}`);
  if (!sources.notion.ok) degraded.push(`notion: ${sources.notion.reason}`);
  if (!sources.github.ok) degraded.push(`github: ${sources.github.reason}`);

  const available = [
    sources.calendar.ok && "calendar",
    sources.gmail.ok && "gmail",
    sources.slack.ok && "slack",
    sources.notion.ok && "notion",
    sources.github.ok && "github",
  ].filter(Boolean) as string[];

  return `You are Ryan's personal assistant. Today is ${dayOfWeek}, ${date} (${timezone}).

Your job is to produce Ryan's end-of-day recap — a first-person journal entry that captures what actually happened today and sets up tomorrow morning. Written at 6pm tonight; re-read at 7am tomorrow.

## Available sources this run

Available: ${available.join(", ") || "(none)"}
${degraded.length > 0 ? `Degraded: ${degraded.join("; ")}` : "All sources ok."}

## Input data (pre-fetched — do not query external systems)

### Calendar (today's events)
${formatCalendar(sources.calendar)}

### Gmail (threads from the last 24h, de-noised via category filters)
${formatGmail(sources.gmail)}

### Slack (DMs + mentions + your replies today)
${formatSlack(sources.slack)}

### Notion (pages edited today in your workspace)
${formatNotion(sources.notion)}

### GitHub (PRs / issues / reviews you touched today)
${formatGitHub(sources.github)}

## Required output sections

Output a JSON object matching the provided schema with these sections, in this order (natural arc: close today → open tomorrow):

1. **todays_wins** — things that actually moved: decisions made, work shipped, meetings that unlocked something. Not "attended standup" — that's not a win.
2. **commitments_made** — explicit or implicit promises Ryan made today. "I'll send the draft Friday." "I'll intro you." Include who it's to. Pulled from Gmail sent, Slack replies, meeting attendance.
3. **loose_ends** — unanswered emails, DMs without a response, asks Ryan ignored. The guilt pile. Be specific about who's waiting and what they asked.
4. **tomorrow_on_deck** — NOT today's calendar. You don't have tomorrow's calendar in the data here — leave this as an empty array and note in the daily_learning that tomorrow-preview is a v1.5 addition.
5. **front_load_candidates** — admin/quick-win tasks for tomorrow AM. Specific actions, not strategic work.
6. **watch_list** — signals brewing that don't need action today but worth monitoring.
7. **questions_surfaced** — things Ryan encountered today but didn't resolve.
8. **daily_learning** — one-line takeaway worth remembering.

**Empty sections:** return an array containing the single string \`"nothing surfaced today"\` (or for daily_learning, that string directly). Don't drop sections.

## Voice and tone

- **First person.** "I committed to sending the draft Friday." Never "Ryan committed..." or "You committed..."
- **Ryan's voice.** Direct, concise, lightly wry, zero corporate jargon. Fragments fine. No exclamation marks, no emojis, no motivational pap.
- **Active verbs.** "I shipped X" not "X was shipped."
- **Include links.** Slack permalinks, Gmail thread URLs, Notion page URLs, GitHub PR URLs. Any time you reference a specific artifact, link it.

## Selectivity rules (HARD — never violate)

- **SKIP** and do not include: login/security notifications, marketing emails, newsletters, automated alerts, subscription confirmations, promotional offers, social media notifications, CI/CD bot messages, "@channel" announcements Ryan didn't engage with, @-mentions in firehose channels where Ryan didn't reply.
- **Include only** real discussion and real commitments — anything that requires a human response or reflects a decision.
- **Slack channel chatter Ryan scrolled past doesn't count.** Only DMs, mentions Ryan engaged with, or replies he sent.
- **Never merge facts across senders, threads, or events.** Each Gmail thread (\`thread:<id>\`), calendar event, and Slack thread is its own context. A name appearing in one thread is NOT the same person as a similarly-described name in another thread. If two emails happen to mention "reschedule to tomorrow 3:30," they describe two separate things unless the \`from_domain\` matches or the same thread id is involved. When mentioning a person by name in the recap, only attribute facts to them that came from the specific thread/event where they appear. Recruiter and interviewer conflations are especially high-stakes — be ruthless about source attribution.

## Selectivity rules (SOFT — use judgment)

- Recurring holds / focus blocks / standups with no specific discussion: skip unless something happened.
- "Got it, thanks!" confirmations: skip.
- Personal/non-work content: include only if clearly relevant.
- **When uncertain, exclude.** A shorter, more selective recap is more valuable than a comprehensive one.
- **If a section has nothing genuinely worth reporting, use the "nothing surfaced today" placeholder. Do not pad with filler.**

## Length target

~400–600 words total across all sections. Skimmable in 60 seconds.

## TL;DR bullets

After the sections, generate 3–5 short bullets (under 90 chars each) for a Slack DM headline. Most important things only — the items that would make Ryan sit up if he saw nothing else.

## Output format

Return a single JSON object matching the provided schema. No prose before or after — just the JSON.

## Degradation

If sources_degraded is non-empty above, mirror that in your output's sources_degraded field (copy each "source: reason" string). Produce the best recap you can with the data you do have.`;
}

// ----------------------------- Formatters -----------------------------

function formatCalendar(src: PromptContext["sources"]["calendar"]): string {
  if (!src.ok) return `(unavailable: ${src.reason})`;
  const events = src.data ?? [];
  if (events.length === 0) return "(no events)";
  return events
    .map((e) => {
      const attendees = e.attendees.length > 0 ? ` [${e.attendees.join(", ")}]` : "";
      const recurring = e.isRecurring ? " [recurring]" : "";
      const allDay = e.isAllDay ? " [all-day]" : "";
      return `- ${e.start} → ${e.end}${allDay}${recurring}: ${e.summary}${attendees}${e.location ? ` @ ${e.location}` : ""} <${e.htmlLink}>`;
    })
    .join("\n");
}

function formatGmail(src: PromptContext["sources"]["gmail"]): string {
  if (!src.ok) return `(unavailable: ${src.reason})`;
  const threads = src.data ?? [];
  if (threads.length === 0) return "(no threads)";
  return threads
    .map((t) => {
      const direction = t.isFromMe ? "SENT" : "RECV";
      // Surface the from-domain explicitly so Claude can see at a glance that
      // two threads are from different senders/companies and must not be
      // merged. The thread id (t.id) is the unambiguous attribution handle.
      const fromDomain = extractDomain(t.from);
      return `- thread:${t.id} | ${direction} | from: ${t.from} | from_domain: ${fromDomain} | to: ${t.to} | subject: ${t.subject}\n  snippet: ${t.snippet}\n  link: ${t.link}`;
    })
    .join("\n");
}

function extractDomain(addr: string): string {
  // `addr` may be "Name <user@example.com>" or just "user@example.com".
  const m = addr.match(/<([^>]+)>/);
  const email = (m ? m[1] : addr).trim().toLowerCase();
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "(unknown)";
}

function formatSlack(src: PromptContext["sources"]["slack"]): string {
  if (!src.ok) return `(unavailable: ${src.reason})`;
  const msgs = src.data ?? [];
  if (msgs.length === 0) return "(no messages)";
  return msgs
    .map((m) => {
      const kind = m.isDM ? "DM" : m.isMention ? "MENTION" : "REPLY";
      return `- [${kind}] ${m.channelName} | from ${m.fromUserName || m.fromUserId}: ${m.text}\n  link: ${m.permalink}`;
    })
    .join("\n");
}

function formatNotion(src: PromptContext["sources"]["notion"]): string {
  if (!src.ok) return `(unavailable: ${src.reason})`;
  const pages = src.data ?? [];
  if (pages.length === 0) return "(no pages edited)";
  return pages
    .map((p) => `- ${p.title} | edited ${p.lastEdited} | ${p.url}`)
    .join("\n");
}

function formatGitHub(src: PromptContext["sources"]["github"]): string {
  if (!src.ok) return `(unavailable: ${src.reason})`;
  const items = src.data ?? [];
  if (items.length === 0) return "(no activity)";
  return items
    .map((i) => `- [${i.kind}] ${i.repo}: ${i.title} (${i.state}) | ${i.url}`)
    .join("\n");
}
