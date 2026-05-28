/**
 * One-time Google OAuth helper. Run locally:
 *
 *   pnpm run auth:google
 *
 * Prerequisite: create a Google Cloud OAuth 2.0 Client ID (Desktop application
 * type). See https://console.cloud.google.com/apis/credentials. Copy the
 * client ID + secret into your env:
 *
 *   export GOOGLE_CLIENT_ID=...
 *   export GOOGLE_CLIENT_SECRET=...
 *
 * This script then:
 *   1. Opens a consent URL in your browser
 *   2. Waits for Google to redirect back to http://localhost:8765/callback
 *   3. Exchanges the auth code for a refresh token
 *   4. Prints the refresh token to paste into Vercel env as GOOGLE_REFRESH_TOKEN
 *
 * Refresh-token longevity depends on the OAuth consent screen's publishing
 * status. In "Testing", external-user refresh tokens are revoked after 7 DAYS
 * (because we request the restricted gmail.readonly scope). The app must be
 * "In production" for long-lived tokens — then they last until revoked or
 * unused for 6 months. (This 7-day trap silently blinded the pipeline once;
 * see decisions.md D17.)
 */

import { google } from "googleapis";
import http from "node:http";
import { exec } from "node:child_process";

const REDIRECT_URI = "http://localhost:8765/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before running.");
    console.error("Get them from: https://console.cloud.google.com/apis/credentials");
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",          // required to get a refresh token
    prompt: "consent",                // forces refresh-token issuance even if already consented
    scope: SCOPES,
  });

  console.log("\n→ Opening Google consent in your browser…");
  console.log("  If it doesn't open automatically, paste this URL:");
  console.log(`  ${authUrl}\n`);

  openInBrowser(authUrl);

  // Spin up a one-shot local HTTP server to receive the redirect.
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", `http://localhost:8765`);
      const c = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "content-type": "text/html" });
        res.end(`<h1>OAuth error: ${err}</h1>`);
        reject(new Error(err));
        server.close();
        return;
      }
      if (c) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          `<h1>✓ Got the code</h1><p>You can close this tab. Check your terminal.</p>`,
        );
        resolve(c);
        server.close();
      }
    });
    server.listen(8765, () => console.log("  Listening on http://localhost:8765/callback…"));
    server.on("error", reject);
  });

  console.log("\n→ Exchanging code for tokens…");
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "\n✗ No refresh_token returned. This usually means you've previously consented to this client.",
    );
    console.error(
      "  Revoke access at https://myaccount.google.com/permissions and re-run.",
    );
    process.exit(1);
  }

  console.log("\n✓ Success. Add these to Vercel env (and .env.local):\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(`GOOGLE_USER_EMAIL=<your Gmail address>`);
  console.log(
    "\nThis token is long-lived ONLY if the consent screen is 'In production'." +
      "\nIn 'Testing' it dies after 7 days (gmail.readonly is a restricted scope).",
  );
}

function openInBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
      ? `start "" "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      // non-fatal; user can paste the URL manually
    }
  });
}

main().catch((err) => {
  console.error("auth-google failed:", err);
  process.exit(1);
});
