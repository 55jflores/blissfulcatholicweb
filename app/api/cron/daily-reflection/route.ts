// Pre-generates the shared daily reflection so the iOS app can fetch it instantly
// instead of streaming Claude on every open (which cold-started and timed out).
// Runs on a Vercel Cron (see vercel.json). Idempotent: upserts by date and skips
// dates that already have a row. Generates a 3-day window (today + 2) so the row
// exists no matter the user's timezone at the midnight rollover.
//
// ⚠️ Requires data/gospels.webce.json — generate + commit it first:
//      node scripts/build-webce-json.mjs   (writes the Gospels subset)
//      git add data/gospels.webce.json
//    The import below resolves at build time, so the deploy fails without it.

import { getSupabaseAdmin } from "@/lib/supabase/server";
import gospels from "@/data/gospels.webce.json";
import { resolveGospel, type GospelsJson } from "@/lib/citation";
import { generateReflection } from "@/lib/daily-reflection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// today, +1, +2 in UTC — covers every user's local date through the rollover.
function upcomingDates(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Reuse the existing /api/liturgy (romcal + readings) for the Gospel citation —
// its readings logic is module-local, so a self-fetch is the clean seam.
async function getGospelCitation(date: string): Promise<string | null> {
  const base = process.env.APP_BASE_URL ?? "https://blissfulcatholic.com";
  const res = await fetch(`${base}/api/liturgy?date=${date}`, { cache: "no-store" });
  if (!res.ok) return null;
  const day = (await res.json()) as { readings?: { label: string; citation: string }[] | null };
  return day.readings?.find((r) => r.label === "Gospel")?.citation ?? null;
}

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically when
  // CRON_SECRET is set in the project env.
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const results: Record<string, string> = {};

  for (const date of upcomingDates(3)) {
    const { data: existing } = await admin
      .from("daily_reflections")
      .select("date")
      .eq("date", date)
      .maybeSingle();
    if (existing) { results[date] = "exists"; continue; } // idempotent

    const citation = await getGospelCitation(date);
    if (!citation) { results[date] = "no-citation"; continue; }

    const text = resolveGospel(citation, gospels as unknown as GospelsJson);
    if (!text) { results[date] = "no-text"; continue; }

    const body = await generateReflection(citation, text);
    if (!body) { results[date] = "no-body"; continue; }

    await admin.from("daily_reflections").upsert({
      date,
      gospel_citation: citation,
      body,
      generated_at: new Date().toISOString(),
    });
    results[date] = "generated";
  }

  return Response.json({ ok: true, results });
}
