export default function Home() {
  return (
    <main
      style={{
        display: "grid",
        gap: "1rem",
        color: "#111",
      }}
    >
      <header
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: "14px",
          padding: "1.5rem",
          background:
            "linear-gradient(180deg, rgba(250,250,250,1) 0%, rgba(245,245,245,1) 100%)",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#666",
            fontWeight: 600,
          }}
        >
          Daily Recap Agent
        </p>
        <h1
          style={{
            margin: "0.5rem 0 0.75rem",
            fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
          }}
        >
          Capture today.
          <br />
          Start tomorrow focused.
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "1rem",
            lineHeight: 1.6,
            color: "#444",
            maxWidth: "58ch",
          }}
        >
          A personal end-of-day system that runs on Vercel Cron, synthesizes your
          day in a sandboxed Claude run, and ships the recap to your reading and
          notification surfaces.
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.75rem",
        }}
      >
        {[
          ["Schedule", "Daily at 6:00 PM CT"],
          ["Pipeline", "Cron -> Workflow -> Sandbox"],
          ["Sources", "Calendar, Gmail, Slack, Notion, GitHub"],
          ["Sinks", "Notion, Archive Repo, Slack DM"],
        ].map(([label, value]) => (
          <article
            key={label}
            style={{
              border: "1px solid #e5e5e5",
              borderRadius: "12px",
              padding: "0.85rem 0.95rem",
              backgroundColor: "#fff",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "0.76rem",
                color: "#666",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {label}
            </p>
            <p
              style={{
                margin: "0.4rem 0 0",
                fontSize: "0.95rem",
                color: "#222",
                lineHeight: 1.5,
              }}
            >
              {value}
            </p>
          </article>
        ))}
      </section>

      <section
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: "14px",
          padding: "1rem",
          backgroundColor: "#fff",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.8rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#666",
            fontWeight: 600,
          }}
        >
          Operations
        </p>
        <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
          <div>
            <p style={{ margin: "0 0 0.4rem", fontWeight: 600 }}>Manual trigger</p>
            <code
              style={{
                display: "block",
                overflowX: "auto",
                padding: "0.65rem 0.75rem",
                borderRadius: "10px",
                border: "1px solid #ececec",
                backgroundColor: "#fafafa",
                fontSize: "0.82rem",
                whiteSpace: "nowrap",
              }}
            >
              curl -H &quot;Authorization: Bearer $CRON_SECRET&quot;
              http://localhost:3000/api/cron/recap
            </code>
          </div>
          <div>
            <p style={{ margin: "0 0 0.4rem", fontWeight: 600 }}>Run history</p>
            <code
              style={{
                display: "block",
                overflowX: "auto",
                padding: "0.65rem 0.75rem",
                borderRadius: "10px",
                border: "1px solid #ececec",
                backgroundColor: "#fafafa",
                fontSize: "0.82rem",
                whiteSpace: "nowrap",
              }}
            >
              npx workflow inspect runs --backend vercel --project daily-recap
            </code>
          </div>
        </div>
      </section>

      <footer
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
        }}
      >
        <a
          href="https://github.com/ryanxkh/daily-recap"
          style={{
            display: "inline-flex",
            alignItems: "center",
            border: "1px solid #111",
            color: "#fff",
            backgroundColor: "#111",
            textDecoration: "none",
            borderRadius: "999px",
            padding: "0.45rem 0.8rem",
            fontSize: "0.86rem",
            fontWeight: 600,
          }}
        >
          View Source
        </a>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            border: "1px solid #e5e5e5",
            color: "#555",
            borderRadius: "999px",
            padding: "0.45rem 0.8rem",
            fontSize: "0.86rem",
            backgroundColor: "#fff",
          }}
        >
          Build Notes: ARCHITECTURE.md
        </span>
      </footer>
    </main>
  );
}
