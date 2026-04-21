export const metadata = {
  title: "Daily Recap Agent",
  description: "Personal EOD recap agent running on Vercel.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          backgroundColor: "#fafafa",
          color: "#111111",
          fontFamily:
            '"Geist", "Geist Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          letterSpacing: "-0.011em",
        }}
      >
        <div
          style={{
            maxWidth: "860px",
            margin: "0 auto",
            padding: "clamp(1rem, 2vw, 1.5rem)",
          }}
        >
          {children}
        </div>
      </body>
    </html>
  );
}
