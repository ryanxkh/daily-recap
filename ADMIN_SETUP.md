# Admin Setup — What You Need Before We Run

Sequenced checklist of external account and integration work. Do these **before** scaffolding the snapshot. Everything here is manual UI/CLI clicking — ~90 min total.

Track with this checklist as you go. When you're done, the Vercel env vars in the table at the bottom should all have values ready to paste.

---

## 1. GitHub repos

### Public code repo
```bash
gh repo create daily-recap --public --description "Personal daily recap agent on Vercel + Claude Code" --clone
```

### Private archive repo
```bash
gh repo create daily-recap-archive --private --description "Private archive of daily recaps. Written by the daily-recap agent."
```

Seed the archive with an empty `recaps/` folder so the first commit has somewhere to land:
```bash
gh api --method PUT /repos/ryanxkh/daily-recap-archive/contents/recaps/.gitkeep \
  -f message="Initialize recaps folder" \
  -f content="$(echo -n '' | base64)"
```

### GitHub Personal Access Token (fine-grained)

Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). Configure:
- **Token name:** `daily-recap-archive-bot`
- **Expiration:** 1 year (or "no expiration" if you're fine with that)
- **Repository access:** Only select repositories → `daily-recap-archive`
- **Repository permissions:**
  - Contents: **Read and write**
  - Metadata: **Read-only** (required automatically)

Copy the generated token → this is your `GITHUB_TOKEN` value.

---

## 2. Notion

### Create the Daily Briefs database

In Notion, create a new database (full page, inline, wherever). Name it **Daily Briefs**. Add these properties (names case-sensitive — the sink code expects them exactly):

| Property | Type | Notes |
|----------|------|-------|
| Name | Title | Default. Stores page title like "Daily Brief — Monday, 2026-04-20" |
| Date | Date | |
| Day | Select | Add options: Monday, Tuesday, …, Sunday |
| Status | Select | Options: Draft, Published |
| Sources | Multi-select | Options: calendar, gmail, slack, notion, github |
| Tags | Multi-select | Optional — leave empty, agent may populate later |

Useful views to add to the database:
- **Calendar view** keyed on `Date` — your main reading surface
- **This week** table view — filter `Date` in the last 7 days

### Create an internal integration

Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **New internal integration**.

- Name: `Daily Recap Agent`
- Associated workspace: your personal workspace
- Capabilities: Read content, Update content, Insert content
- Comment capabilities: none needed

Click **Save** → copy the **Internal Integration Secret** → this is `NOTION_TOKEN`.

### Share the database with the integration

Open the **Daily Briefs** database in Notion → **⋯** menu → **Connections** → **Connect to** → select **Daily Recap Agent**.

### Get the database ID

The database URL looks like:
```
https://notion.so/<workspace>/<DATABASE_ID>?v=<view_id>
```

Copy the 32-char DATABASE_ID (no dashes) → this is `NOTION_DAILY_BRIEFS_DB_ID`.

---

## 3. Slack

### Create a Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.

- Name: `Daily Recap Agent`
- Workspace: your Vercel workspace (or wherever you want DMs delivered)

### Add bot scopes

Under **OAuth & Permissions** → **Bot Token Scopes**, add:
- `chat:write`
- `im:write`
- `users:read`

*(If you want the agent to also READ Slack from inside the sandbox via the Slack MCP, add these too:)*
- `channels:history`
- `groups:history`
- `im:history`
- `mpim:history`
- `search:read`

### Install the app to your workspace

**Install App** → **Install to Workspace** → approve. Copy the **Bot User OAuth Token** (starts with `xoxb-`) → this is `SLACK_BOT_TOKEN`.

### Find your Slack user ID

In Slack: click your avatar → **Profile** → **⋯** → **Copy member ID**. Format: `UXXXXXXXXX`. This is `SLACK_USER_ID`.

---

## 4. Anthropic API key

Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) → **Create Key**. Scope as needed.

Copy → this is `ANTHROPIC_API_KEY`. This is used by Claude Code CLI running inside the sandbox.

---

## 4.5 Google Cloud OAuth (for Gmail + Calendar)

Since Option F: we read Gmail + Calendar directly from Vercel Functions using `googleapis`, which needs an OAuth 2.0 client.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → pick or create a project (name it `daily-recap` or use an existing personal project)
2. **APIs & Services → Library** → enable:
   - **Gmail API**
   - **Google Calendar API**
3. **APIs & Services → OAuth consent screen**:
   - User Type: **External** (unless you have a Google Workspace — then Internal is fine)
   - App name: `Daily Recap Agent`
   - User support email: your email
   - Developer contact: your email
   - Scopes: skip (we'll send scopes at runtime)
   - Test users: **add your own Gmail address** (required while app is in testing)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**
   - Name: `daily-recap-cli`
   - Save → copy the **Client ID** and **Client Secret**

Then locally:

```bash
export GOOGLE_CLIENT_ID=<paste>
export GOOGLE_CLIENT_SECRET=<paste>
pnpm run auth:google
```

Browser opens → approve both Gmail + Calendar scopes → terminal prints the refresh token. Add all 4 values to Vercel env:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_USER_EMAIL` — your Gmail address (for filtering sent vs received in the Gmail source)

The refresh token doesn't expire unless revoked or unused for 6 months.

---

## 5. Vercel project

### Link the local repo

```bash
cd daily-recap
vercel link
# → create new project, "daily-recap"
```

This creates `.vercel/project.json` with your team + project IDs.

### Generate CRON_SECRET

```bash
openssl rand -hex 32
# → copy the output
```

### Push env vars to Vercel

For each of the variables in the table below, run:

```bash
vercel env add <VAR_NAME> production preview development
# paste value when prompted
```

Or set via the dashboard: `https://vercel.com/<team>/daily-recap/settings/environment-variables`.

### Pull env vars locally

```bash
vercel env pull .env.local --yes
```

---

## 6. Confirm Vercel Sandbox access

`@vercel/sandbox` requires your Vercel plan to have Sandbox enabled. As of early 2026, check:

```bash
vercel --version
# (current major version required)
```

And confirm at [vercel.com/docs/sandbox](https://vercel.com/docs/sandbox) that your plan tier has it enabled. If not, upgrade or switch the snapshot pattern to an alternative container runtime (outside v1 scope).

---

## Env var checklist

After all the above, your Vercel project env vars should include:

| Name | Source | Environments |
|------|--------|--------------|
| `CRON_SECRET` | `openssl rand -hex 32` | prod, preview, dev |
| `ANTHROPIC_API_KEY` | Anthropic console | prod, preview, dev |
| `NOTION_TOKEN` | Notion integration | prod, preview, dev |
| `NOTION_DAILY_BRIEFS_DB_ID` | Notion DB URL | prod, preview, dev |
| `SLACK_BOT_TOKEN` | Slack app install | prod, preview, dev |
| `SLACK_USER_ID` | Slack profile | prod, preview, dev |
| `GITHUB_TOKEN` | GitHub PAT | prod, preview, dev |
| `GITHUB_ARCHIVE_OWNER` | your GitHub username | prod, preview, dev |
| `GITHUB_ARCHIVE_REPO` | `daily-recap-archive` | prod, preview, dev |
| `TIMEZONE` | `America/Chicago` | prod, preview, dev |
| `VERCEL_SANDBOX_SNAPSHOT_ID` | From `bake-snapshot` (later) | prod, preview, dev |

Verify locally:
```bash
vercel env pull .env.local --yes
# diff .env.local against .env.example — should have the same keys
```

---

## When this checklist is done, you're ready to:

1. `pnpm install`
2. `pnpm run bake-snapshot` (interactive — Claude will prompt you for Google OAuth)
3. Add the returned `snap_...` ID as `VERCEL_SANDBOX_SNAPSHOT_ID` in Vercel env
4. `vercel deploy`
5. Manual trigger: `curl -H "Authorization: Bearer $CRON_SECRET" https://<deployment>.vercel.app/api/cron/recap`
6. Watch the run in `npx workflow inspect runs --backend vercel --project daily-recap`
7. Tune the prompt over the first few days based on what surfaces in real recaps
