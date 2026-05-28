// AI proxy — STUB.
//
// This is the route that MANDATES a backend: it holds the Anthropic key, runs
// the theological safety filter, enforces rate limits (via api_usage), and gates
// on subscription entitlement — none of which can live on the client.
//
// Returns 501 until the real integration lands in its own Phase 3 step
// (built with the claude-api skill: prompt caching, the foundation.ts system
// prompt, JWT auth via getSupabaseForToken, usage logging, and tier gating).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function POST() {
  return NextResponse.json(
    {
      error: "not_implemented",
      message: "The AI endpoint is not wired up yet. Coming in a later Phase 3 step.",
    },
    { status: 501 }
  );
}
