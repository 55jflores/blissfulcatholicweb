// Public read for the pre-generated daily reflection. The iOS Daily card fetches
// this (fast, CDN-cached) instead of streaming /api/ai. Returns the camelCase
// shape the app's DailyReflection model decodes directly.

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
  // to daily_reflections by date, so there's nothing sensitive to leak.
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("daily_reflections")
    .select("date, gospel_citation, body, generated_at")
    .eq("date", date)
    .maybeSingle();
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });

  return Response.json(
    {
      date: data.date,
      gospelCitation: data.gospel_citation,
      body: data.body,
      generatedAt: data.generated_at, // ISO-8601; iOS decodes with .iso8601
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
  );
}
