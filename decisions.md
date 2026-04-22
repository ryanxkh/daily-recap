# Decision Log

Running log of decisions made while building this. ADR-lite format: what, alternatives, why. Updated as we go. Great fodder for the eventual writeup.

---

## 2026-04-20 — D1: Primary job is EOD capture that becomes morning brief

**Decision:** Build this as a single artifact with dual-reading-moments: written at 6pm, read again at 7am the next day. Forward-looking sections (tomorrow on deck, front-load candidates) sit alongside backward-looking sections (wins, commitments, loose ends).

**Alternatives considered:**
- Pure morning briefing (no EOD capture) — rejected: reduces compound knowledge value
- Signal extractor only (just the 3–5 things I'd miss) — rejected: too thin
- Weekly-review feeder only — rejected: daily cadence is the point

**Why:** The EOD → AM flow mirrors how I already think. The same artifact serves both moments with different reading intent.

---

## 2026-04-20 — D2: Five sources, WhatsApp deferred

**Decision:** Calendar + Gmail + Slack + Notion + GitHub. WhatsApp skipped for v1.

**Alternatives considered:**
- Community `whatsapp-web.js` MCP — rejected: fragile (paired phone session breaks on WA updates, needs periodic re-pair)
- WhatsApp Business Cloud API — rejected: requires business verification, overkill
- Forward-WA-to-email workaround — rejected for v1: adds manual step

**Why:** The five chosen sources cover ~95% of my work signal. WhatsApp is worth revisiting if a specific use case emerges.

---

## 2026-04-20 — D3: Three sinks (fan-out)

**Decision:** Write to (a) Notion database page, (b) markdown file in private archive repo, (c) Slack DM with TL;DR + link.

**Alternatives considered:**
- Single-sink (Notion only) — rejected: no archive, no push notification
- Notion + Slack only — rejected: loses the compounding long-term log
- Markdown + Slack only — rejected: Notion is my primary reading surface

**Why:** Three sinks, three jobs — Notion is the reading surface, markdown is the archive, Slack is the push notification. Each earns its place.

---

## 2026-04-20 — D4: Notion structure = database, not folder hierarchy

**Decision:** `Daily Briefs` database with `Date`, `Day`, `Status`, `Tags` properties. Page per day.

**Alternatives considered:**
- Nested page hierarchy (`Daily Briefs / 2026 / April / 2026-04-20`) — rejected: no filter/calendar views, 365 pages/year painful to browse
- Single rolling page — rejected: bloats fast

**Why:** Database gives calendar view, table view, tag filters for free. Weekly-review feeder is a simple filter.

---

## 2026-04-20 — D5: Archive path `recaps/YYYY-MM/YYYY-MM-DD.md`

**Decision:** Month-sharded folders in a **separate private repo** (`daily-recap-archive`).

**Alternatives considered:**
- `recaps/YYYY-MM-DD.md` flat — rejected: 365 files/year in one folder is ugly to browse on GitHub
- `recaps/YYYY/MM/DD.md` three-level — rejected: deep nesting for no real benefit
- Same repo as code — **rejected for privacy**: code repo is public; recap content names Vercel people/deals/projects and cannot be public

**Why:** Separation of concerns — code is public (blog asset); content is private (actual daily log). Month-sharding keeps GitHub file lists manageable.

---

## 2026-04-20 — D6: Cadence = 7 days/week, 6pm CT

**Decision:** Run every day at 6pm CT. Cron expression: `0 23 * * *` UTC (= 6pm CDT summer / 5pm CST winter).

**Alternatives considered:**
- Weekdays only — rejected: weekend async work still worth capturing, and the rhythm matters
- 7pm or 9pm trigger — rejected: too late, want to read-and-close the loop before cooking dinner
- 5am next-day trigger — rejected: the journaling value comes from writing at EOD, not auto-generation

**Why:** Daily rhythm unbroken. 6pm is "most meetings done, pre-dinner" sweet spot.

**Known gotcha:** DST flips drift the local time by 1 hour twice a year. Accept manual fix in November and March.

---

## 2026-04-20 — D7: 8-section structure, 1st person, 400–600 words

**Decision:** Sections in order — Today's wins → Commitments made → Loose ends → Tomorrow on deck → Front-load candidates → Watch list → Questions surfaced → Daily learning.

Voice: 1st person ("I committed..."). Empty sections keep header with `"nothing surfaced today"` placeholder. Tone: my voice (applied via tone-of-voice skill baked into snapshot).

**Alternatives considered:**
- 3rd person ("Ryan committed...") — rejected: feels distant, bad for journal
- 2nd person ("You committed...") — rejected: slightly action-forcing but feels like a chief-of-staff briefing
- Drop empty sections — rejected: inconsistent structure day-to-day makes scanning harder

**Why:** 1st person reads like a journal entry future-me wrote. 8 sections × ~60 words each = ~480 words. Fits the "skimmable in 60 seconds" target.

---

## 2026-04-20 — D8: Env-var injected auth (tokens live in Vercel env, not snapshot)

**Decision:** Snapshot holds only software + Claude managed-connector auth state. Per-service tokens (Notion, Slack, GitHub) injected at runtime via Vercel env vars.

**Alternatives considered:**
- Snapshot-baked tokens — rejected: rotation requires rebaking the snapshot (slow, ugly)

**Why:** Separates "frozen software" from "refreshable secrets." Rotate creds instantly via Vercel dashboard.

---

## 2026-04-20 — D9: Graceful degradation on single-source failure

**Decision:** Any single MCP failure → agent produces a degraded recap with a visible note at top. All-sources failure → diagnostic Slack DM with error detail + WDK run URL.

**Alternatives considered:**
- Fail-fast (any MCP error kills the run) — rejected: losing a whole day because Gmail API 500s is too brittle

**Why:** First week will have auth hiccups; degraded recaps keep the rhythm going while I debug.

---

## 2026-04-20 — D10: Vercel Workflow (WDK), not plain API route

**Decision:** Use WDK with one `"use workflow"` orchestrator and five `"use step"` functions (sandbox, Notion, GitHub, Slack, log).

**Alternatives considered:**
- Plain Next.js API route — rejected: no durable-execution retries means one transient Slack 500 forces re-running Claude (expensive)

**Why:** Three-sink fan-out is exactly where durable execution earns its keep. Each sink is independently retriable without re-invoking the Claude step.

---

## 2026-04-20 — D11: Observability via WDK built-ins, no custom dashboard

**Decision:** Use `npx workflow web` + `npx workflow inspect runs` for run history. Slack DMs on success and failure. No custom `/status` page or Vercel KV run log for v1.

**Alternatives considered:**
- Full telemetry (KV run log + custom dashboard) — initially chosen, then revised after reviewing WDK docs: the built-in tooling already provides run history, step timings, retry history. Custom dashboard = ~4 hours of work duplicating existing functionality.

**Why:** WDK gives observability for free. If a public-facing `/status` page becomes useful for the blog post demo, add it as v1.5.

---

## 2026-04-20 — D12: Claude managed connectors for Gmail + Google Calendar

> **Status: Superseded by D15.** The managed-connector surface doesn't exist in the Claude Code CLI (only in Claude.ai / Routines), which invalidated the premise of this decision. D15 pivots to prefetching Google data in Vercel Functions using `googleapis`.

**Decision:** Use Anthropic's managed MCP connectors (`mcp__claude_ai_Gmail__*`, `mcp__claude_ai_Google_Calendar__*`) instead of writing custom Google OAuth refresh-token helpers.

**Alternatives considered:**
- Custom Google OAuth via desktop-app client — rejected: ~2 hours of code + ongoing refresh-token management
- Community third-party Google MCPs — rejected: auth story still requires custom OAuth setup

**Why:** Anthropic handles the entire OAuth lifecycle. One-click browser auth during snapshot bake; then headless use thereafter. Massively simpler.

**Caveat:** Must verify headless behavior in snapshot works as expected on day 1. Fallback to custom OAuth if it doesn't.

---

## 2026-04-20 — D13: Two GitHub repos (public code, private content)

**Decision:** `daily-recap` (public) holds code, infra, docs. `daily-recap-archive` (private) holds generated recap markdown files.

**Alternatives considered:**
- Single private repo — rejected: defeats blog-post intent
- Single public repo with all content — rejected: recap content contains private work details (Vercel people, deals, projects) that can't be public

**Why:** Public code for writeup + private content for privacy. Clean split.

---

## 2026-04-20 — D14: Sinks written via SDK, not via MCP

**Decision:** Notion, GitHub, and Slack writes happen in WDK step functions using official SDKs (`@notionhq/client`, `@octokit/rest`, `@slack/web-api`) — **not** through the agent via MCP.

**Alternatives considered:**
- Have Claude write sinks via MCP tools (Drew's Reflect pattern) — rejected: Claude sometimes misformats structured writes, adds round-trip latency, muddies error attribution

**Why:** Claude reads; we write. Separation of concerns. More reliable, faster, cleaner error handling.

---

---

## 2026-04-20 — D15: Pivot to "Option F" — prefetch in Vercel, synthesize in Sandbox

**Decision:** All source data (Calendar, Gmail, Slack, Notion, GitHub) is fetched by Vercel Workflow steps using official SDKs BEFORE the sandbox boots. Claude Code inside the sandbox only synthesizes — it never calls any external API. The MCPs are removed from the sandbox entirely.

**Alternatives considered:**
- **Original plan (MCPs inside sandbox)** — blocked because Claude Code CLI v2.1.114 has no managed-connector surface. Google OAuth would require community MCPs with their own auth dance each, which defeated the original "managed-connector" simplification that justified the MCP-heavy design.
- **Anthropic Routines (Sam Shapiro's article pattern)** — would solve Google auth but pulls architecture off Vercel entirely.
- **Hybrid Routines + Vercel** — cleanest Google story but two systems to debug.
- **Community Google MCPs in sandbox** — still needs custom OAuth, adds fragility.

**Why:** This architecture is cleaner, more debuggable (curl the source endpoints directly), showcases every Vercel primitive we want to learn (Functions, Workflow, Sandbox, Cron, env, OIDC), and sidesteps the Claude Code managed-connector dead-end entirely. Sinks already used SDKs directly (D14); this extends the same pattern to sources.

**Concrete changes:**
- `lib/sources/{calendar,gmail,slack,notion-reads,github-reads}.ts` — 5 new modules, one per source
- `scripts/auth-google.ts` — one-time local OAuth helper that prints a refresh token
- `lib/prompt.ts` — now accepts prefetched data as a `PromptContext`, embeds it in the prompt
- `lib/sandbox.ts` — no more MCP config rendering, no token injection into sandbox (except ANTHROPIC_API_KEY)
- `snapshot/setup.sh` + `scripts/bake-snapshot.ts` — minimal bake (Node + Claude CLI, nothing else)
- Env vars added: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_USER_EMAIL`

**Trade-off accepted:** Claude can't dynamically drill down into sources during synthesis. For a daily recap with known data needs, this is the right trade.

---

## 2026-04-20 — D16: Prompt-tuning lessons from Sam & Michael

**Decision:** Port three filter patterns from the two "AI Chief of Staff" articles into our prompt:

1. **Explicit SKIP list.** Sam's enumeration: "login/security notifications, marketing, newsletters, automated alerts, subscription confirmations, promotional offers, social media notifications" — much tighter than our original rules. Added to `lib/prompt.ts` HARD rules.
2. **No padding on empty sections.** Michael's implicit rule: if nothing qualifies, say so — do not fill space. Already in our architecture via the "nothing surfaced today" placeholder; prompt now reinforces "Do not pad with filler."
3. **"Priorities.md" pattern — deferred to v1.5.** Sam/Michael both have a living priorities doc the agent reads each run. Worth adding later so the recap can flag aging priorities. Not a v1 blocker.

**Why:** These articles are newer than our initial prompt design, and both authors are clearly iterating on real recaps. Free tuning.

**Not adopting:**
- Michael's "5 modes" framing — useful for general AI collaboration, overkill for a one-shot recap agent
- Sam's "monthly review" branch — premature; revisit after 30 days of runs
- Obsidian as reading UI — Notion database serves the same purpose for us

---

## Upcoming decisions (not yet made)

- Exact Claude Code CLI behavior with `--output-format json --json-schema`: does it wrap in `structured_output`? (verify day 1)
- Specific Slack app scopes to request (minimum viable set — currently generous)
- Cost caps / spend alerts setup
- Whether to add a `priorities.md` input file in v1.5
