/**
 * GitHub archive sink — creates a markdown file in a private archive repo.
 *
 * Path pattern: recaps/YYYY-MM/YYYY-MM-DD.md
 * Month-sharded folders to keep GitHub browsing tidy.
 *
 * Uses `createOrUpdateFileContents` so re-running on the same day overwrites
 * rather than erroring. This matters for the "manually trigger to retry" flow
 * when a token has been rotated mid-day.
 */

import { Octokit } from "@octokit/rest";
import type { Recap } from "../schema";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function writeArchiveMarkdown(recap: Recap): Promise<{ path: string; sha: string }> {
  const owner = requireEnv("GITHUB_ARCHIVE_OWNER");
  const repo = requireEnv("GITHUB_ARCHIVE_REPO");

  const [yyyy, mm] = recap.date.split("-");
  const path = `recaps/${yyyy}-${mm}/${recap.date}.md`;
  const markdown = renderMarkdown(recap);

  // Fetch existing file SHA if it exists (so we can update in place).
  let existingSha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({ owner, repo, path });
    if (!Array.isArray(existing.data) && existing.data.type === "file") {
      existingSha = existing.data.sha;
    }
  } catch (err) {
    // 404 means the file doesn't exist yet — that's fine, we'll create it.
    if (!isNotFound(err)) throw err;
  }

  const res = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: `Add daily recap for ${recap.date}`,
    content: Buffer.from(markdown, "utf-8").toString("base64"),
    sha: existingSha,
    committer: {
      name: "daily-recap-bot",
      email: "daily-recap-bot@users.noreply.github.com",
    },
    author: {
      name: "daily-recap-bot",
      email: "daily-recap-bot@users.noreply.github.com",
    },
  });

  return {
    path,
    sha: res.data.content?.sha ?? "",
  };
}

function renderMarkdown(recap: Recap): string {
  const lines: string[] = [];
  lines.push(`# Daily Brief — ${recap.day_of_week}, ${recap.date}`);
  lines.push("");

  if (recap.sources_degraded.length > 0) {
    lines.push(`> ⚠️ **Degraded sources:** ${recap.sources_degraded.join("; ")}`);
    lines.push("");
  }

  lines.push("## TL;DR");
  for (const bullet of recap.tldr_bullets) {
    lines.push(`- ${bullet}`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");

  section(lines, "Today's wins", recap.sections.todays_wins);
  section(lines, "Commitments I made", recap.sections.commitments_made);
  section(lines, "Loose ends", recap.sections.loose_ends);

  lines.push("## Tomorrow on deck");
  if (recap.sections.tomorrow_on_deck.length === 0) {
    lines.push("nothing surfaced today");
  } else {
    for (const m of recap.sections.tomorrow_on_deck) {
      lines.push(`- **${m.meeting}** — ${m.prep_note}`);
    }
  }
  lines.push("");

  section(lines, "Front-load candidates", recap.sections.front_load_candidates);
  section(lines, "Watch list", recap.sections.watch_list);
  section(lines, "Questions surfaced", recap.sections.questions_surfaced);

  lines.push("## Daily learning");
  lines.push(recap.sections.daily_learning);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`*Sources: ${recap.sources_available.join(", ")}*`);

  return lines.join("\n");
}

function section(lines: string[], heading: string, items: string[]) {
  lines.push(`## ${heading}`);
  if (items.length === 0) {
    lines.push("nothing surfaced today");
  } else {
    for (const item of items) lines.push(`- ${item}`);
  }
  lines.push("");
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status: unknown }).status === 404;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
