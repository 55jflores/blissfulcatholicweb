// Server-side gates for the AI route: who is calling, what they're entitled to,
// and how much they've used. All of this MUST live on the server — it's the
// reason the AI goes through Next.js instead of iOS → Anthropic directly.

import { getSupabaseAdmin, getSupabaseForToken } from "@/lib/supabase/server";

export type Entitlement = "free" | "plus";

// Rolling-24h request ceilings, keyed by entitlement. These are abuse guards
// (every AI call has real marginal cost), not the monetization boundary — that's
// feature gating below. Tune as real usage data comes in.
const DAILY_LIMITS: Record<Entitlement, number> = {
  free: 5,
  plus: 200,
};

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Resolve the caller from their Supabase JWT. Returns null if unauthenticated. */
export async function getCaller(
  accessToken: string
): Promise<{ userId: string } | null> {
  const supa = getSupabaseForToken(accessToken);
  const { data, error } = await supa.auth.getUser();
  if (error || !data.user) return null;
  return { userId: data.user.id };
}

/** A user's current entitlement. Absence of a subscription row = free. */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("subscriptions")
    .select("entitlement, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return "free";
  // Only an active/trialing Plus subscription grants the entitlement.
  const active = data.status === "active" || data.status === "trialing";
  return active && data.entitlement === "plus" ? "plus" : "free";
}

/**
 * Count this user's AI calls in the rolling window. Uses the
 * (user_id, created_at desc) index on api_usage, so it's a cheap range scan.
 */
export async function checkRateLimit(
  userId: string,
  entitlement: Entitlement
): Promise<{ allowed: boolean; used: number; limit: number; retryAfterMs: number }> {
  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await admin
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);

  const used = count ?? 0;
  const limit = DAILY_LIMITS[entitlement];
  return { allowed: used < limit, used, limit, retryAfterMs: WINDOW_MS };
}

/** Append one row to api_usage — the rate-limit source and the cost ledger. */
export async function logUsage(params: {
  userId: string;
  endpoint: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("api_usage").insert({
    user_id: params.userId,
    endpoint: params.endpoint,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
  });
  // Don't fail the user's request if logging hiccups — just surface it server-side.
  if (error) console.error("api_usage insert failed:", error.message);
}
