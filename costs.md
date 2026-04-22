# Cost Tracking

Tracking actual operating cost of the daily recap agent. Updated monthly.

## Target

**< $5 / month** for daily runs (30 recaps/month).

## Cost sources

| Component | Pricing model | Est. per-run | Est. monthly |
|---|---|---|---|
| Vercel (Next.js host) | Existing plan | — | $0 marginal |
| Vercel Cron | Included in plan | — | $0 |
| Vercel Workflow | Included (beta/GA TBD) | — | $0 |
| Vercel Sandbox | Per-second metered | ~$0.05–$0.15 | ~$2–$5 |
| Anthropic API (Claude Code) | Per-token | ~$0.10–$0.50 | ~$3–$15 |
| Notion API | Free | — | $0 |
| Slack API | Free | — | $0 |
| GitHub API | Free | — | $0 |
| Google APIs (Gmail + Calendar) | Free tier via `googleapis` SDK | — | $0 |
| **Total** | | | **~$5–$20** |

## Actuals (live tracking)

### 2026-04 (build month)

_To fill in once runs start. Expect higher numbers in month 1 due to development iteration._

| Date | Sandbox cost | Claude tokens | Notes |
|------|--------------|---------------|-------|
| TBD  | —            | —             | —     |

## Optimization levers (if budget blows)

1. **Reduce tool-call volume** — prompt Claude to be more targeted
2. **Shorter sandbox runs** — bump `max_tool_iterations` down
3. **Cheaper Claude model** for non-critical runs — Haiku for weekends?
4. **Skip quiet days** — if 0 meetings + 0 active Slack, skip the run entirely
5. **Cache calendar lookups** — meetings list changes rarely during the day
