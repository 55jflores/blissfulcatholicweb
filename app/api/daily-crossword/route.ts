// Public read for the pre-generated daily crossword. The iOS Daily card
// fetches this (fast, CDN-cached). The stored payload is already the exact
// camelCase shape the app's DailyCrossword model decodes — served verbatim.
// The solution rows ship to the client by design: it's a free puzzle with
// client-side check/reveal.

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: "bad_request", message: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  // Service role bypasses RLS; the row is public content and the query is fixed
  // to daily_crosswords by date, so there's nothing sensitive to leak.
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("daily_crosswords")
    .select("puzzle")
    .eq("date", date)
    .maybeSingle();
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });

  return Response.json(data.puzzle, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
