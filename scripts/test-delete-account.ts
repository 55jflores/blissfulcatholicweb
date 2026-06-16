// Full-pipeline test for DELETE /api/account. Admin-creates a confirmed
// throwaway user (works even with "Confirm email" ON), signs them in for a
// JWT, then exercises the route: 401 unauthenticated → 200 delete → rows gone
// → 401 on replay with the dead token.
//
// Requires the dev server running (npm run dev) AND all keys in .env.local.
// Run:
//   npx tsx --env-file=.env.local scripts/test-delete-account.ts

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.AI_BASE_URL ?? "http://localhost:3000";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishable || !secret) {
    fail("Missing Supabase env vars. Run with --env-file=.env.local");
  }

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Admin-create a confirmed throwaway user.
  const email = `test+delete${Date.now()}@blissfulcatholic.test`;
  const password = `Test-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  console.log(`\n  Creating ${email} …`);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) fail(`createUser failed: ${createErr?.message}`);
  const userId = created.user.id;
  console.log(`  ✓ Created user ${userId}`);

  // 2. Sign in for a JWT.
  const supa = createClient(url, publishable);
  const { data: signedIn, error: signInErr } = await supa.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !signedIn.session) fail(`signIn failed: ${signInErr?.message}`);
  const token = signedIn.session.access_token;
  console.log("  ✓ Got JWT");

  // 3. Confirm the public.users mirror row exists (signup trigger).
  const { data: mirrorBefore } = await admin
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (!mirrorBefore) fail("public.users row missing before delete (trigger broken?)");
  console.log("  ✓ public.users row present");

  // 4. No token → 401.
  const unauthed = await fetch(`${BASE}/api/account`, { method: "DELETE" });
  if (unauthed.status !== 401) fail(`expected 401 without token, got ${unauthed.status}`);
  console.log("  ✓ 401 without a token");

  // 5. With token → 200.
  const res = await fetch(`${BASE}/api/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) fail(`expected 200, got ${res.status}: ${await res.text()}`);
  console.log("  ✓ 200 — account deleted");

  // 6. auth.users + public.users rows are gone.
  const { data: afterUser } = await admin.auth.admin.getUserById(userId);
  if (afterUser?.user) fail("auth.users row still exists after delete");
  const { data: mirrorAfter } = await admin
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (mirrorAfter) fail("public.users row still exists after delete (cascade broken?)");
  console.log("  ✓ auth.users + public.users rows gone");

  // 7. Replay with the dead token → 401.
  const replay = await fetch(`${BASE}/api/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (replay.status !== 401) fail(`expected 401 on replay, got ${replay.status}`);
  console.log("  ✓ 401 on replay with the dead token");

  console.log("\n  All checks passed.\n");
}

main().catch((err) => {
  console.error("\n✗", err?.message ?? err);
  process.exit(1);
});
