// /privacy — public privacy policy page.
//
// Renders docs/privacy.md as HTML using `marked`. The page is statically
// generated at build time (`force-static`), so once a build is deployed the
// page is served as plain pre-rendered HTML — no per-request file reads on
// Vercel. To update, edit docs/privacy.md and redeploy.

import fs from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy — Blissful Catholic",
  description:
    "How Blissful Catholic collects, uses, and protects your information.",
};

async function getPolicyHtml(): Promise<string> {
  const filePath = path.join(process.cwd(), "docs/privacy.md");
  const md = await fs.readFile(filePath, "utf-8");
  return await marked.parse(md, { gfm: true, breaks: false });
}

export default async function PrivacyPage() {
  const html = await getPolicyHtml();
  return (
    <main
      style={{
        maxWidth: "44rem",
        margin: "0 auto",
        padding: "3rem 1.5rem 5rem",
        lineHeight: 1.7,
      }}
    >
      <a
        href="/"
        style={{
          display: "inline-block",
          marginBottom: "2.5rem",
          color: "var(--gold)",
          textDecoration: "none",
          fontSize: "0.9rem",
        }}
      >
        ← Back to home
      </a>

      <article
        className="policy-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <style>{`
        .policy-body { color: var(--ink); font-size: 1rem; }
        .policy-body h1 {
          font-size: 2.25rem;
          font-weight: 500;
          margin-top: 0;
          margin-bottom: 0.5rem;
          letter-spacing: -0.01em;
        }
        .policy-body h2 {
          font-size: 1.5rem;
          font-weight: 600;
          margin-top: 2.5rem;
          margin-bottom: 0.75rem;
          color: var(--ink);
        }
        .policy-body h3 {
          font-size: 1.15rem;
          font-weight: 600;
          margin-top: 1.75rem;
          margin-bottom: 0.5rem;
        }
        .policy-body p { margin: 0.75em 0; }
        .policy-body ul, .policy-body ol {
          margin: 0.75em 0;
          padding-left: 1.5em;
        }
        .policy-body li { margin: 0.35em 0; }
        .policy-body hr {
          margin: 2.5rem 0;
          border: none;
          border-top: 1px solid var(--rule);
        }
        .policy-body a {
          color: var(--gold);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .policy-body strong { color: var(--ink); font-weight: 600; }
        .policy-body em { color: var(--ink-soft); }
        .policy-body code {
          background: rgba(184, 149, 106, 0.12);
          padding: 0.1em 0.35em;
          border-radius: 3px;
          font-family: ui-monospace, monospace;
          font-size: 0.9em;
        }
        .policy-body table {
          width: 100%;
          margin: 1em 0;
          border-collapse: collapse;
          font-size: 0.95em;
        }
        .policy-body th, .policy-body td {
          padding: 0.6rem 0.5rem;
          text-align: left;
          border-bottom: 1px solid var(--rule);
          vertical-align: top;
        }
        .policy-body th {
          font-weight: 600;
          color: var(--ink);
          background: rgba(184, 149, 106, 0.06);
        }
      `}</style>
    </main>
  );
}
