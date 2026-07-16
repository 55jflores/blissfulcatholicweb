// Pre-generates the daily Catholic mini crossword (see lib/crossword/) so the
// iOS app fetches a finished puzzle. Runs on a Vercel Cron (see vercel.json).
// No AI involved — generation is a deterministic dictionary fill, so a 7-day
// window costs nothing and covers every timezone plus a week of missed crons.
//
// Contract: a date that already has a row is NEVER regenerated. The fill is
// deterministic per (date, dictionary), so editing the dictionary would change
// history — and a player's half-solved grid must never shift under them.

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { generatePuzzle } from "@/lib/crossword/generate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// today … today+6 in UTC — covers every user's local date through the rollover.
function upcomingDates(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Grid keys of recently shipped puzzles — generatePuzzle re-rolls a date whose
// fill collides with one, so the same grid can't recur within the window.
const AVOID_WINDOW_DAYS = 60;

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically when
  // CRON_SECRET is set in the project env.
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const cutoff = new Date(Date.now() - AVOID_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // One query serves both needs: which upcoming dates already exist, and which
  // grids to avoid (ISO dates compare correctly as strings).
  const { data: recent, error: recentError } = await admin
    .from("daily_crosswords")
    .select("date, puzzle")
    .gte("date", cutoff);
  if (recentError) {
    return Response.json({ ok: false, error: recentError.message }, { status: 500 });
  }

  const existing = new Set((recent ?? []).map((r) => r.date as string));
  const avoid = new Set<string>();
  for (const r of recent ?? []) {
    const rows = (r.puzzle as { rows?: string[] })?.rows;
    if (Array.isArray(rows)) avoid.add(rows.join("/"));
  }

  const results: Record<string, string> = {};
  for (const date of upcomingDates(7)) {
    if (existing.has(date)) { results[date] = "exists"; continue; } // immutable
    try {
      const puzzle = await generatePuzzle(date, { avoid });
      const { error } = await admin.from("daily_crosswords").insert({
        date,
        puzzle,
        theme: puzzle.theme?.label ?? null,
        generated_at: puzzle.generatedAt,
      });
      if (error) { results[date] = `insert-error: ${error.message}`; continue; }
      avoid.add(puzzle.rows.join("/"));
      results[date] = "generated";
    } catch (err) {
      results[date] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return Response.json({ ok: true, results });
}
