# Daily crossword — pre-generated, served to the app

A 5×5 all-Catholic mini crossword, generated **once per day by a cron** from a
curated word+clue dictionary and a deterministic grid filler. No AI at
generation time — zero runtime cost, safe to automate. On feast days the grid
is seeded with the saint's vocabulary; in Advent/Christmas/Lent/Easter it leans
on season-tagged words (via romcal, same calendar as `/api/liturgy`).

## What's here

| Path | Role |
|---|---|
| `app/api/cron/daily-crossword/route.ts` | 8:30am UTC cron — generates today + 6 days, **never overwrites an existing date** |
| `app/api/daily-crossword/route.ts` | public read the app fetches (`?date=YYYY-MM-DD`), CDN-cached |
| `lib/crossword/` | the engine: templates → slots → backtracking fill → validation → payload |
| `data/crossword-words.json` | the dictionary (~500 entries: answer, clue variants, tags, feast dates) |
| `scripts/generate-crosswords.ts` | ASCII preview for human review; `--date`, `--days`, `--verify-determinism`, `--upsert` |
| `scripts/test-crossword-fill.ts` | feasibility gate — run before shipping ANY dictionary or template change |
| `supabase/schema.sql` | adds the `daily_crosswords` table (RLS on, no policy → service-role only) |
| `vercel.json` | registers the cron (`30 8 * * *`, **UTC**, staggered off the reflection cron) |

## Setup (in order)

**1. Apply the schema.** Supabase dashboard → SQL Editor → paste
`supabase/schema.sql` (or just the new `daily_crosswords` block) → Run.

**2. Env vars** — nothing new. Reuses `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SECRET_KEY`.

**3. Deploy.** The cron registers from `vercel.json` on deploy.

**4. Seed + verify.**
```bash
# Trigger once so today…today+6 rows exist (per-date status in the response):
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://blissfulcatholic.com/api/cron/daily-crossword
# → {"ok":true,"results":{"2026-07-15":"generated", …}}

# Confirm the read endpoint returns the payload the app expects:
curl "https://blissfulcatholic.com/api/daily-crossword?date=2026-07-15"
# → {"date":"…","size":5,"rows":["#...#",…],"clues":{…},"theme":…,"generatedAt":"…"}
```

## Editing the dictionary (`data/crossword-words.json`)

- **Adding entries is always safe** — shipped dates never regenerate, and more
  words only widens future fills.
- **Removing or respelling an answer** only affects future dates, but run the
  gate first: the launch templates were validated against the current list, and
  thinning a length class (3s especially) can sink fill rates.
- **Clue edits** are safe; each answer carries 1–3 clue variants and the
  generator picks per date.
- **`feastDates`** must be General-Roman-Calendar-verified (`MM-DD`). A wrong
  date makes the theme note name the wrong feast — worse than no theme.
- After ANY edit: `npx tsx scripts/test-crossword-fill.ts` must pass (≥99% fill
  per template, 365/365 days, no repeats inside the 60-day window), then eyeball
  a couple of weeks: `npx tsx scripts/generate-crosswords.ts --days 14`.

## Notes

- **Determinism:** a puzzle is a pure function of (date, dictionary, recent
  grids). The cron passes the last 60 days' grids as an avoid-set; on collision
  the RNG is re-salted deterministically. Local preview and prod produce the
  same puzzles given the same history.
- **Immutability:** the cron skips any date that already has a row. Manual
  backfills via `scripts/generate-crosswords.ts --upsert` obey the same rule.
- **Templates are empirically gated.** Only layouts that fill ≥99% AND produce
  100+ distinct grids across 200 seeds ship (see `lib/crossword/templates.ts`
  — the fully-checked corner layout filled 100% but only ever reached 4
  distinct grids, so it was cut). Never add or flip a template without
  re-running the gate.
- **7-day window:** generation is free, so the cron writes a week ahead —
  UTC+14 users and several missed cron days are a non-event.
- **Security:** `daily_crosswords` has RLS enabled with no policy — only the
  service role touches it; the app reads through `/api/daily-crossword`, never
  Supabase directly. Solutions ship to the client by design (free puzzle,
  client-side check/reveal).
