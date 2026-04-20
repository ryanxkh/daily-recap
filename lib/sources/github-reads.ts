/**
 * GitHub source — your authored PRs, reviews, issues, and comments today.
 *
 * Uses GitHub Search API via Octokit. Scoped to the token holder's activity
 * across all repos they have access to.
 */

import { Octokit } from "@octokit/rest";
import type { DateWindow, Result } from "./types";

export interface GitHubActivityItem {
  kind: "pr-authored" | "pr-review" | "issue-authored" | "issue-comment";
  title: string;
  url: string;
  repo: string;                // "owner/repo"
  updatedAt: string;           // ISO
  state?: string;              // open/closed/merged
}

export async function fetchGitHub(
  window: DateWindow,
): Promise<Result<GitHubActivityItem[]>> {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return { ok: false, reason: "GITHUB_TOKEN missing" };

    const octo = new Octokit({ auth: token });

    // Find the user associated with the token.
    const me = await octo.users.getAuthenticated();
    const login = me.data.login;
    const date = window.date;

    const queries = [
      { kind: "pr-authored" as const, q: `is:pr author:${login} updated:${date}` },
      { kind: "pr-review" as const, q: `is:pr reviewed-by:${login} updated:${date}` },
      { kind: "issue-authored" as const, q: `is:issue author:${login} updated:${date}` },
      { kind: "issue-comment" as const, q: `is:issue commenter:${login} updated:${date}` },
    ];

    const items: GitHubActivityItem[] = [];
    for (const { kind, q } of queries) {
      const res = await octo.search.issuesAndPullRequests({ q, per_page: 20 });
      for (const it of res.data.items) {
        items.push({
          kind,
          title: it.title,
          url: it.html_url,
          repo: it.repository_url.replace("https://api.github.com/repos/", ""),
          updatedAt: it.updated_at,
          state: it.state,
        });
      }
    }

    // Dedupe by URL — one PR can match multiple queries
    const byUrl = new Map<string, GitHubActivityItem>();
    for (const it of items) byUrl.set(it.url, it);

    return { ok: true, data: Array.from(byUrl.values()) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
