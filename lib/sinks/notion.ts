/**
 * Notion sink — writes one page per day into the Daily Briefs database.
 *
 * The database must exist before first run. See snapshot/README.md for the
 * "admin setup" checklist that creates it with the right property schema.
 *
 * Expected database properties (names case-sensitive — created by the database
 * bootstrap, see Command Center → Daily Briefs in Notion):
 *   - "Name"             (title)
 *   - "Date"             (date)
 *   - "Day"              (select)           Monday..Sunday
 *   - "Status"           (select)           Published | Draft | Failed | Degraded
 *   - "Sources"          (multi_select)     calendar, gmail, slack, notion, github
 *   - "Sources Degraded" (multi_select)     subset of Sources
 *   - "Word Count"       (number)
 *   - "TL;DR Count"      (number)
 *   - "Commitments"      (number)
 *   - "Loose Ends"       (number)
 *   - "Tags"             (multi_select)
 *   - "Key People"       (multi_select)
 *   - "Run ID"           (rich_text)        WDK run ID
 *   - "Created"          (created_time, system-managed)
 */

import { Client } from "@notionhq/client";
import type { Recap } from "../schema";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export async function writeNotionPage(
  recap: Recap,
  meta?: { runId?: string },
): Promise<{ url: string; id: string }> {
  const dbId = requireEnv("NOTION_DAILY_BRIEFS_DB_ID");

  const wordCount = countWords(recap);
  const status = recap.sources_degraded.length > 0 ? "Degraded" : "Published";

  const page = await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      Name: {
        title: [
          {
            text: { content: `Daily Brief — ${recap.day_of_week}, ${recap.date}` },
          },
        ],
      },
      Date: { date: { start: recap.date } },
      Day: { select: { name: recap.day_of_week } },
      Status: { select: { name: status } },
      Sources: {
        multi_select: recap.sources_available.map((s) => ({ name: s })),
      },
      "Sources Degraded": {
        // Each degraded entry is "source: reason" — extract just the source name
        // for the multi-select. Full reason still surfaces in the page body.
        multi_select: recap.sources_degraded
          .map((s) => s.split(":")[0].trim())
          .filter((s) => ["calendar", "gmail", "slack", "notion", "github"].includes(s))
          .map((name) => ({ name })),
      },
      "Word Count": { number: wordCount },
      "TL;DR Count": { number: recap.tldr_bullets.length },
      Commitments: { number: recap.sections.commitments_made.length },
      "Loose Ends": { number: recap.sections.loose_ends.length },
      ...(meta?.runId
        ? {
            "Run ID": {
              rich_text: [{ text: { content: meta.runId } }],
            },
          }
        : {}),
    },
    children: buildBlocks(recap),
  });

  const url = "url" in page ? (page.url as string) : "";
  return { url, id: page.id };
}

function countWords(recap: Recap): number {
  const chunks: string[] = [];
  chunks.push(...recap.sections.todays_wins);
  chunks.push(...recap.sections.commitments_made);
  chunks.push(...recap.sections.loose_ends);
  chunks.push(...recap.sections.tomorrow_on_deck.map((m) => `${m.meeting} ${m.prep_note}`));
  chunks.push(...recap.sections.front_load_candidates);
  chunks.push(...recap.sections.watch_list);
  chunks.push(...recap.sections.questions_surfaced);
  chunks.push(recap.sections.daily_learning);
  return chunks.join(" ").split(/\s+/).filter(Boolean).length;
}

function buildBlocks(recap: Recap) {
  const blocks: Record<string, unknown>[] = [];

  // Degradation note at top, only if something failed
  if (recap.sources_degraded.length > 0) {
    blocks.push(calloutBlock(
      `⚠️ Some sources were unavailable today: ${recap.sources_degraded.join("; ")}`,
      "orange_background",
    ));
  }

  // TL;DR callout — always first
  blocks.push(headingBlock("TL;DR", 2));
  for (const bullet of recap.tldr_bullets) {
    blocks.push(bulletBlock(bullet));
  }

  blocks.push(dividerBlock());

  // Sections in the order defined by the prompt
  blocks.push(headingBlock("Today's wins", 2));
  addListOrPlaceholder(blocks, recap.sections.todays_wins);

  blocks.push(headingBlock("Commitments I made", 2));
  addListOrPlaceholder(blocks, recap.sections.commitments_made);

  blocks.push(headingBlock("Loose ends", 2));
  addListOrPlaceholder(blocks, recap.sections.loose_ends);

  blocks.push(headingBlock("Tomorrow on deck", 2));
  if (recap.sections.tomorrow_on_deck.length === 0) {
    blocks.push(paragraphBlock("nothing surfaced today"));
  } else {
    for (const m of recap.sections.tomorrow_on_deck) {
      blocks.push(bulletBlock(`${m.meeting} — ${m.prep_note}`));
    }
  }

  blocks.push(headingBlock("Front-load candidates", 2));
  addListOrPlaceholder(blocks, recap.sections.front_load_candidates);

  blocks.push(headingBlock("Watch list", 2));
  addListOrPlaceholder(blocks, recap.sections.watch_list);

  blocks.push(headingBlock("Questions surfaced", 2));
  addListOrPlaceholder(blocks, recap.sections.questions_surfaced);

  blocks.push(headingBlock("Daily learning", 2));
  blocks.push(paragraphBlock(recap.sections.daily_learning));

  return blocks;
}

function addListOrPlaceholder(blocks: Record<string, unknown>[], items: string[]) {
  if (items.length === 0) {
    blocks.push(paragraphBlock("nothing surfaced today"));
    return;
  }
  for (const item of items) {
    blocks.push(bulletBlock(item));
  }
}

// Notion block helpers — these return the shape the @notionhq/client
// expects for children arrays. Minimal, no formatting beyond what's needed.

function headingBlock(text: string, level: 2 | 3) {
  const key = `heading_${level}` as const;
  return {
    object: "block",
    type: key,
    [key]: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

function paragraphBlock(text: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}

function bulletBlock(text: string) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}

function dividerBlock() {
  return { object: "block", type: "divider", divider: {} };
}

function calloutBlock(text: string, color: string) {
  return {
    object: "block",
    type: "callout",
    callout: {
      rich_text: [{ type: "text", text: { content: text } }],
      color,
    },
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
