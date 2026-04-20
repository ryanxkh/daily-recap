export default function Home() {
  return (
    <main>
      <h1>Daily Recap Agent</h1>
      <p>
        A personal EOD recap agent. Runs daily at 6pm CT via Vercel Cron. Boots a
        Vercel Sandbox, runs Claude Code headless with MCPs for
        Google/Slack/Notion/GitHub, and fans the output out to Notion, a private
        archive repo, and Slack.
      </p>
      <p>
        See{" "}
        <a href="https://github.com/ryanxkh/daily-recap">GitHub</a> for code,{" "}
        <code>ARCHITECTURE.md</code> for the build narrative.
      </p>
      <p>
        <strong>Manual trigger:</strong>{" "}
        <code>
          curl -H &quot;Authorization: Bearer $CRON_SECRET&quot;
          /api/cron/recap
        </code>
      </p>
      <p>
        <strong>Run history:</strong>{" "}
        <code>npx workflow inspect runs --backend vercel --project daily-recap</code>
      </p>
    </main>
  );
}
