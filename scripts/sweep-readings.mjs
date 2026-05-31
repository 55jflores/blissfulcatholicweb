// sweep-readings.mjs
//
// Surveys the upstream Catholic Readings API (cpbjr.github.io/catholic-readings-api)
// across a window of liturgical years, identifies missing reading slots per day,
// and emits a coverage report. Informs whether we need to build our own daily
// readings dataset or whether a small fixed-date fallback table is sufficient.
//
// Why three years (2025-2027):
//   - 2025: Year C Sundays + Year I weekdays
//   - 2026: Year A Sundays + Year II weekdays
//   - 2027: Year B Sundays + Year I weekdays
//   Covers all three Sunday cycles (A/B/C) and both weekday cycles (I/II), and
//   triple-samples each fixed-date Solemnity so year-specific upstream omissions
//   are detected.
//
// Run:  node scripts/sweep-readings.mjs
//
// Output:
//   scripts/data/readings-cache/YYYY-MM-DD.json  (raw upstream responses, idempotent on re-run)
//   scripts/data/readings-coverage.json          (full per-day analysis)
//   stdout                                       (markdown summary)

import romcal from "romcal";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const YEARS = [2025, 2026, 2027];
const UPSTREAM_BASE = "https://cpbjr.github.io/catholic-readings-api/readings";
const CACHE_DIR = path.join(REPO_ROOT, "scripts/data/readings-cache");
const REPORT_PATH = path.join(REPO_ROOT, "scripts/data/readings-coverage.json");
const USER_AGENT = "BlissfulCatholic-Sweep/1.0 (+jesus.flores1008@gmail.com)";
const BATCH_SIZE = 10;
const INTER_BATCH_MS = 50;
const READING_KEYS = ["firstReading", "psalm", "secondReading", "gospel"];

// ---------------------------------------------------------------------------
// Fetch with on-disk cache. Idempotent — re-running the script doesn't refetch.

async function fetchReading(date) {
  const cachePath = path.join(CACHE_DIR, `${date}.json`);
  try {
    const cached = await fs.readFile(cachePath, "utf8");
    return JSON.parse(cached);
  } catch {
    // not cached — fall through to network
  }

  const [yyyy, mm, dd] = date.split("-");
  const url = `${UPSTREAM_BASE}/${yyyy}/${mm}-${dd}.json`;
  let body;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    body = res.ok
      ? await res.json()
      : { _meta: { status: res.status, fetchedAt: new Date().toISOString() } };
  } catch (err) {
    body = { _meta: { error: String(err), fetchedAt: new Date().toISOString() } };
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(body, null, 2));
  return body;
}

// ---------------------------------------------------------------------------
// Expected reading count derived from romcal rank + special-case overrides.

function expectedReadingCount(rank, celebration) {
  // The Easter Vigil has up to 9 readings (7 OT + Epistle + Gospel). Common
  // pastoral practice abridges to 3-5 OT, but the upstream may list all 9.
  // We treat this as a special case so it doesn't dominate the gap stats.
  if (/easter vigil/i.test(celebration)) return 9;

  // Sundays, Solemnities, and Feasts of the Lord get a Second Reading; ferias,
  // saints' memorials, and most apostles' feasts do not.
  switch (rank) {
    case "SUNDAY":
    case "SOLEMNITY":
    case "FEAST_OF_THE_LORD":
      return 4;
    case "FEAST":
      // Most feasts (apostles, evangelists) have 3 readings; the Lord's feasts
      // that fall on a Sunday have 4 (handled by SUNDAY above when applicable).
      return 3;
    default:
      // MEMORIAL, OPT_MEMORIAL, FERIA, COMMEMORATION, …
      return 3;
  }
}

// ---------------------------------------------------------------------------
// Sweep one calendar year.

async function sweepYear(year) {
  process.stderr.write(`▸ ${year}: building romcal calendar...\n`);
  const cal = await romcal.calendarFor({
    year,
    country: "unitedStates",
    locale: "en",
  });
  process.stderr.write(`  ${cal.length} days; fetching upstream in batches of ${BATCH_SIZE}...\n`);

  const entries = [];
  for (let i = 0; i < cal.length; i += BATCH_SIZE) {
    const batch = cal.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (day) => {
        const date = String(day.moment).slice(0, 10);
        const data = await fetchReading(date);
        const haveSlots =
          data?.readings && typeof data.readings === "object"
            ? READING_KEYS.filter(
                (k) => typeof data.readings[k] === "string" && data.readings[k].trim().length > 0
              )
            : [];
        const expected = expectedReadingCount(day.type, day.name);
        const upstreamError = data?._meta?.status ?? data?._meta?.error ?? null;
        return {
          date,
          celebration: day.name,
          rank: day.type,
          season: day.data?.season?.value ?? null,
          have: haveSlots,
          expected,
          gap: Math.max(0, expected - haveSlots.length),
          upstreamError,
        };
      })
    );
    entries.push(...results);
    if (INTER_BATCH_MS > 0) await new Promise((r) => setTimeout(r, INTER_BATCH_MS));
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Summary report.

function printSummary(allEntries) {
  const total = allEntries.length;
  const errors = allEntries.filter((e) => e.upstreamError);
  const gaps = allEntries.filter((e) => !e.upstreamError && e.gap > 0);

  console.log("# Catholic Readings API coverage sweep");
  console.log();
  console.log(`Years swept:        ${YEARS.join(", ")}`);
  console.log(`Total days:         ${total}`);
  console.log(`Upstream errors:    ${errors.length}`);
  console.log(`Days with gaps:     ${gaps.length}  (${((100 * gaps.length) / total).toFixed(1)}%)`);
  console.log();

  // Errors by status code
  if (errors.length > 0) {
    const byStatus = {};
    for (const e of errors) {
      const key = String(e.upstreamError);
      byStatus[key] = (byStatus[key] || 0) + 1;
    }
    console.log("## Upstream errors");
    for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status.padEnd(40)} ${count}`);
    }
    console.log();
  }

  // Gaps by rank — tells us whether they cluster on visible days
  if (gaps.length > 0) {
    const byRank = {};
    for (const g of gaps) byRank[g.rank] = (byRank[g.rank] || 0) + 1;
    console.log("## Gaps by rank");
    for (const [rank, count] of Object.entries(byRank).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${rank.padEnd(20)} ${count}`);
    }
    console.log();
  }

  // Which reading slot is most commonly missing
  if (gaps.length > 0) {
    const missingSlot = { firstReading: 0, psalm: 0, secondReading: 0, gospel: 0 };
    for (const g of gaps) {
      const expectedSlots =
        g.expected === 4 ? READING_KEYS : ["firstReading", "psalm", "gospel"];
      for (const slot of expectedSlots) {
        if (!g.have.includes(slot)) missingSlot[slot]++;
      }
    }
    console.log("## Missing slot frequency (across all gap days)");
    for (const [slot, count] of Object.entries(missingSlot)) {
      if (count > 0) console.log(`  ${slot.padEnd(20)} ${count}`);
    }
    console.log();
  }

  // Detail — first 60 gap days
  if (gaps.length > 0) {
    console.log("## Gap detail (first 60)");
    for (const g of gaps.slice(0, 60)) {
      const haveStr = g.have.length > 0 ? g.have.join("+") : "(none)";
      console.log(
        `  ${g.date}  ${String(g.rank).padEnd(12)}  ${g.celebration}`
      );
      console.log(`              have: ${haveStr}  expect: ${g.expected}`);
    }
    if (gaps.length > 60) {
      console.log(`  ... and ${gaps.length - 60} more (see ${path.relative(REPO_ROOT, REPORT_PATH)})`);
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Main.

async function main() {
  const all = [];
  for (const year of YEARS) {
    const year_entries = await sweepYear(year);
    all.push(...year_entries);
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(all, null, 2));

  printSummary(all);

  process.stderr.write(`\n✓ Full report: ${path.relative(REPO_ROOT, REPORT_PATH)}\n`);
  process.stderr.write(`✓ Raw cache:   ${path.relative(REPO_ROOT, CACHE_DIR)}/\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
