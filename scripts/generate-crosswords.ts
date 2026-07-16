// Human-review preview for the daily crossword engine. Prints ASCII grids +
// numbered clues + theme lines so puzzle quality can be judged before anything
// ships. No DB access unless --upsert is passed.
//
// Run:
//   npx tsx scripts/generate-crosswords.ts                      # today + 13 more
//   npx tsx scripts/generate-crosswords.ts --start 2026-07-20 --days 7
//   npx tsx scripts/generate-crosswords.ts --date 2026-12-25
//   npx tsx scripts/generate-crosswords.ts --date 2026-07-20 --verify-determinism
//   npx tsx --env-file=.env.local scripts/generate-crosswords.ts --days 7 --upsert

import { generatePuzzle } from "../lib/crossword/generate";
import type { Puzzle } from "../lib/crossword/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function render(puzzle: Puzzle): string {
  const lines: string[] = [];
  const themeLine = puzzle.theme ? `${puzzle.theme.label} — ${puzzle.theme.note}` : "(no theme)";
  lines.push(`\n═══ ${puzzle.date}  ${themeLine}`);
  for (const row of puzzle.rows) {
    lines.push("   " + row.split("").map((ch) => (ch === "#" ? "■" : ch)).join(" "));
  }
  lines.push("   ACROSS");
  for (const c of puzzle.clues.across) lines.push(`    ${String(c.number).padStart(2)}. ${c.clue} (${c.answer})`);
  lines.push("   DOWN");
  for (const c of puzzle.clues.down) lines.push(`    ${String(c.number).padStart(2)}. ${c.clue} (${c.answer})`);
  return lines.join("\n");
}

// Deep-compare two puzzles ignoring generatedAt (the one intentionally
// non-deterministic field).
function samePuzzle(a: Puzzle, b: Puzzle): boolean {
  const strip = ({ generatedAt: _, ...rest }: Puzzle) => JSON.stringify(rest);
  return strip(a) === strip(b);
}

async function upsert(puzzles: Puzzle[]) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    console.error("✗ --upsert needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (run with --env-file=.env.local)");
    process.exit(1);
  }
  const admin = createClient(url, secret);
  for (const puzzle of puzzles) {
    // Match the cron's contract: never overwrite a shipped date.
    const { data: existing } = await admin
      .from("daily_crosswords")
      .select("date")
      .eq("date", puzzle.date)
      .maybeSingle();
    if (existing) {
      console.log(`  ${puzzle.date}: exists — skipped`);
      continue;
    }
    const { error } = await admin.from("daily_crosswords").insert({
      date: puzzle.date,
      puzzle,
      theme: puzzle.theme?.label ?? null,
      generated_at: puzzle.generatedAt,
    });
    console.log(error ? `  ${puzzle.date}: ✗ ${error.message}` : `  ${puzzle.date}: inserted`);
  }
}

async function main() {
  const single = arg("date");
  const start = single ?? arg("start") ?? utcToday();
  const days = single ? 1 : Number(arg("days") ?? 14);

  const puzzles: Puzzle[] = [];
  const avoid = new Set<string>(); // grids already used earlier in this run
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const avoidSnapshot = new Set(avoid);
    const puzzle = await generatePuzzle(date, { avoid: avoidSnapshot });
    puzzles.push(puzzle);
    avoid.add(puzzle.rows.join("/"));
    console.log(render(puzzle));

    if (has("verify-determinism")) {
      const again = await generatePuzzle(date, { avoid: avoidSnapshot });
      console.log(samePuzzle(puzzle, again) ? "   ✓ deterministic" : "   ✗ NOT DETERMINISTIC");
      if (!samePuzzle(puzzle, again)) process.exit(1);
    }
  }

  const themed = puzzles.filter((p) => p.theme).length;
  console.log(`\n${puzzles.length} puzzles, ${themed} themed.`);

  if (has("upsert")) await upsert(puzzles);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
