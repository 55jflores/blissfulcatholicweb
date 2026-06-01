// Placeholder landing page. The marketing/web frontend for blissfulcatholic.com
// comes later; for now this just confirms the app boots and sets the tone.

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "2rem",
        position: "relative",
      }}
    >
      <div style={{ color: "var(--gold)", fontSize: "1.5rem", marginBottom: "1.25rem" }}>
        ✦
      </div>
      <h1 style={{ fontSize: "2.75rem", fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>
        Blissful Catholic
      </h1>
      <p
        style={{
          color: "var(--ink-soft)",
          fontSize: "1.125rem",
          maxWidth: "32rem",
          marginTop: "1rem",
          lineHeight: 1.6,
        }}
      >
        An AI spiritual companion for the Catholic faith. The app is on its way.
      </p>

      <footer
        style={{
          position: "absolute",
          bottom: "1.5rem",
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: "1.25rem",
          fontSize: "0.85rem",
          color: "var(--ink-soft)",
        }}
      >
        <a
          href="/privacy"
          style={{
            color: "var(--ink-soft)",
            textDecoration: "none",
            opacity: 0.75,
          }}
        >
          Privacy
        </a>
      </footer>
    </main>
  );
}
