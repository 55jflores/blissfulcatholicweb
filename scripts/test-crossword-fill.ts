// Feasibility gate for the crossword dictionary + engine. Run before shipping
// dictionary changes. Exits non-zero if the dictionary fails lint or any
// enabled template's fill success rate drops below 99%.
//
// Run:
//   npx tsx scripts/test-crossword-fill.ts
//   npx tsx scripts/test-crossword-fill.ts --open        # also test the open grid
//   npx tsx scripts/test-crossword-fill.ts --start 2026-01-01

import { loadDictionary, validateDictionary, buildIndex } from "../lib/crossword/dictionary";
import { TEMPLATES, OPEN_TEMPLATE } from "../lib/crossword/templates";
import { fillGrid } from "../lib/crossword/fill";
import { createRng } from "../lib/crossword/rng";
import { generatePuzzle } from "../lib/crossword/generate";

const has = (name: string) => process.argv.includes(`--${name}`);
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ATTEMPTS_PER_TEMPLATE = 200;
const YEAR_DAYS = 365;
const MIN_SUCCESS = 0.99;
const P95_BUDGET_MS = 500;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  let failed = false;

  // ── 1. Dictionary lint ────────────────────────────────────────────────
  const entries = loadDictionary();
  const errors = validateDictionary(entries);
  if (errors.length > 0) {
    console.error(`✗ dictionary lint: ${errors.length} error(s)`);
    for (const e of errors) console.error(`   ${e}`);
    process.exit(1);
  }
  const byLen = new Map<number, number>();
  for (const e of entries) byLen.set(e.answer.length, (byLen.get(e.answer.length) ?? 0) + 1);
  console.log(`✓ dictionary lint clean — ${entries.length} entries`);
  const targets: Record<number, number> = { 3: 110, 4: 170, 5: 200 };
  for (const len of [3, 4, 5]) {
    const n = byLen.get(len) ?? 0;
    const flag = n < targets[len] ? `  ⚠ below target ${targets[len]}` : "";
    console.log(`   length ${len}: ${n}${flag}`);
  }

  // ── 2. Per-template force fill (no theme seeds, random seeds) ─────────
  const index = buildIndex(entries);
  const templates = has("open") ? [...TEMPLATES, OPEN_TEMPLATE] : TEMPLATES;
  console.log(`\nper-template fill (${ATTEMPTS_PER_TEMPLATE} attempts each):`);
  for (const template of templates) {
    let ok = 0;
    const times: number[] = [];
    for (let i = 0; i < ATTEMPTS_PER_TEMPLATE; i++) {
      const rng = createRng(`feasibility-${template.id}-${i}`);
      const t0 = performance.now();
      const result = fillGrid(template, index, rng);
      times.push(performance.now() - t0);
      if (result) ok++;
    }
    const rate = ok / ATTEMPTS_PER_TEMPLATE;
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    const verdict = rate >= MIN_SUCCESS ? "✓" : "✗ BELOW 99%";
    if (rate < MIN_SUCCESS) failed = true;
    console.log(
      `   ${verdict} ${template.id.padEnd(15)} ${(rate * 100).toFixed(1)}%  p95 ${p95.toFixed(0)}ms  max ${times[times.length - 1].toFixed(0)}ms`
    );
  }

  // ── 3. A full year of real generation (theme seeding included) ────────
  // Mirrors the prod cron: each day avoids the grids of the previous 60 days.
  const start = arg("start") ?? new Date().toISOString().slice(0, 10);
  console.log(`\nfull-year generation from ${start}:`);
  const freq = new Map<string, number>();
  const times: number[] = [];
  const window: string[] = []; // grid keys of the trailing AVOID_WINDOW days
  const AVOID_WINDOW = 60;
  let themed = 0;
  let generated = 0;
  let windowDups = 0;
  for (let i = 0; i < YEAR_DAYS; i++) {
    const date = addDays(start, i);
    try {
      const t0 = performance.now();
      const avoid = new Set(window);
      const puzzle = await generatePuzzle(date, { avoid });
      times.push(performance.now() - t0);
      generated++;
      if (puzzle.theme) themed++;
      const key = puzzle.rows.join("/");
      if (avoid.has(key)) {
        windowDups++;
        console.error(`   ⚠ ${date}: grid repeats within ${AVOID_WINDOW}-day window`);
      }
      window.push(key);
      if (window.length > AVOID_WINDOW) window.shift();
      for (const c of [...puzzle.clues.across, ...puzzle.clues.down]) {
        freq.set(c.answer, (freq.get(c.answer) ?? 0) + 1);
      }
    } catch (err) {
      failed = true;
      console.error(`   ✗ ${date}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (windowDups > 0) failed = true;
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
  console.log(`   ${generated}/${YEAR_DAYS} generated, ${themed} themed (${((themed / YEAR_DAYS) * 100).toFixed(0)}%)`);
  console.log(`   p95 ${p95.toFixed(0)}ms  max ${(times[times.length - 1] ?? 0).toFixed(0)}ms`);
  if (p95 > P95_BUDGET_MS) {
    failed = true;
    console.error(`   ✗ p95 over ${P95_BUDGET_MS}ms budget`);
  }

  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log(`   most-reused answers (of ${freq.size} distinct used):`);
  for (const [word, n] of top) console.log(`      ${word.padEnd(6)} ×${n}`);

  console.log(failed ? "\n✗ FEASIBILITY GATE FAILED" : "\n✓ feasibility gate passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
