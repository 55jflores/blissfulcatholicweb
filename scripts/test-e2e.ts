// Full-pipeline test for POST /api/ai. Signs up a throwaway user via Supabase,
// grabs their JWT, and calls the real route — exercising auth → entitlement →
// rate-limit → Claude stream → usage logging.
//
// Requires the dev server running (npm run dev) AND all keys in .env.local.
// Run:
//   npx tsx --env-file=.env.local scripts/test-e2e.ts
//   npx tsx --env-file=.env.local scripts/test-e2e.ts catechism "What is grace?"

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.AI_BASE_URL ?? "http://localhost:3000";
const [, , maybeFeature, ...rest] = process.argv;
const feature = maybeFeature ?? "daily";
const question = rest.join(" ") || "What should I reflect on today?";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable) {
    console.error("✗ Missing Supabase env vars. Run with --env-file=.env.local");
    process.exit(1);
  }

  // 1. Sign up a throwaway user (email confirmation must be OFF to get a session).
  const supa = createClient(url, publishable);
  const email = `test+${Date.now()}@blissfulcatholic.test`;
  const password = `Test-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  console.log(`\n  Signing up ${email} …`);
  const { data, error } = await supa.auth.signUp({ email, password });
  if (error) {
    console.error(`✗ signUp failed: ${error.message}`);
    process.exit(1);
  }
  const token = data.session?.access_token;
  if (!token) {
    console.error(
      "✗ No session returned. Is 'Confirm email' still ON? Turn it off in Supabase → Auth → Providers → Email."
    );
    process.exit(1);
  }
  console.log(`  ✓ Got JWT (user ${data.user?.id})`);

  // 2. Call the real route with the JWT.
  console.log(`\n  POST ${BASE}/api/ai  feature=${feature}`);
  console.log(`  question: ${question}\n  ${"─".repeat(50)}\n`);

  const res = await fetch(`${BASE}/api/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      feature,
      messages: [{ role: "user", content: question }],
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    console.error(`✗ HTTP ${res.status}: ${text}`);
    process.exit(1);
  }

  // 3. Parse the SSE stream.
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const evt = JSON.parse(line.slice("data: ".length));
      if (evt.type === "text") process.stdout.write(evt.text);
      else if (evt.type === "done")
        console.log(`\n\n  ${"─".repeat(50)}\n  ✓ done (stop: ${evt.stop_reason})\n`);
      else if (evt.type === "error") console.error(`\n✗ stream error: ${evt.message}`);
    }
  }
}

main().catch((err) => {
  console.error("\n✗", err?.message ?? err);
  process.exit(1);
});
