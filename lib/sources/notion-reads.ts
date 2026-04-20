/**
 * Notion source — pages edited today in your workspace.
 *
 * Uses Notion's search endpoint with a last_edited_time filter.
 * Limited by what your NOTION_TOKEN integration has access to — i.e.,
 * pages and databases you've explicitly shared with the integration.
 *
 * For v1, this is the Daily Briefs database itself (mostly its previous
 * entries — useful for "this morning's brief said X, how did I follow through")
 * and any other pages you choose to connect. Add more as useful.
 */

import { Client } from "@notionhq/client";
import type { DateWindow, Result } from "./types";

export interface NotionPageSummary {
  id: string;
  title: string;
  lastEdited: string;         // ISO
  url: string;
  parentType: string;
}

export async function fetchNotionEdits(
  window: DateWindow,
): Promise<Result<NotionPageSummary[]>> {
  try {
    const token = process.env.NOTION_TOKEN;
    if (!token) return { ok: false, reason: "NOTION_TOKEN missing" };

    const notion = new Client({ auth: token });

    // Notion's search doesn't have a date filter built in, but we can sort
    // by last_edited_time descending and cut off when entries get too old.
    const res = await notion.search({
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 50,
    });

    const cutoff = new Date(window.date + "T00:00:00Z").getTime();
    const pages: NotionPageSummary[] = [];
    for (const r of res.results) {
      if (r.object !== "page") continue;
      // Shape varies; do defensive extraction
      const page = r as {
        id: string;
        last_edited_time?: string;
        url?: string;
        parent?: { type?: string };
        properties?: Record<string, unknown>;
      };
      const editedMs = new Date(page.last_edited_time ?? 0).getTime();
      if (editedMs < cutoff) break; // sorted desc, so safe to stop

      pages.push({
        id: page.id,
        title: extractTitle(page.properties) ?? "(untitled)",
        lastEdited: page.last_edited_time ?? "",
        url: page.url ?? "",
        parentType: page.parent?.type ?? "",
      });
    }

    return { ok: true, data: pages };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function extractTitle(properties: Record<string, unknown> | undefined): string | undefined {
  if (!properties) return undefined;
  for (const prop of Object.values(properties)) {
    const p = prop as { type?: string; title?: Array<{ plain_text?: string }> };
    if (p.type === "title" && Array.isArray(p.title)) {
      return p.title.map((t) => t.plain_text ?? "").join("");
    }
  }
  return undefined;
}
