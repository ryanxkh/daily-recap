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
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "720px", margin: "0 auto" }}>
        {children}
      </body>
    </html>
  );
}
