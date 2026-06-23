# Daily reflection — pre-generated, served to the app

The Daily card's reflection is generated **once per day by a cron** and stored,
so the iOS app fetches it instantly instead of streaming `/api/ai` on every open
(which cold-started and surfaced as "Couldn't load today's reflection — the
request timed out"). The personalized "Reflect with your companion" sheet still
streams `/api/ai` unchanged.

## What's here

| Path | Role |
|---|---|
| `app/api/cron/daily-reflection/route.ts` | 4am cron — generates today + 2 days, upserts by date |
| `app/api/daily-reflection/route.ts` | public read the app fetches (`?date=YYYY-MM-DD`) |
| `lib/daily-reflection.ts` | the Claude call — `claude-sonnet-4-6` + `FOUNDATION_SYSTEM_PROMPT` (mirrors `FEATURE_MODEL.daily`) |
| `lib/citation.ts` | Gospel citation → verse text (port of the iOS `CitationParser` + resolver) |
| `data/gospels.webce.json` | Gospels-only WEBCE subset (~480 KB), emitted by `scripts/build-webce-json.mjs` |
| `supabase/schema.sql` | adds the `daily_reflections` table (RLS on, no policy → service-role only) |
| `vercel.json` | registers the cron (`0 8 * * *`, **UTC**) |

## Setup (in order)

**0. Generate + commit the Gospels subset — required before the first build.**
The cron `import`s `@/data/gospels.webce.json` at build time, so the deploy fails
without it.
```bash
node scripts/build-webce-json.mjs      # writes data/gospels.webce.json (+ the gitignored full webce.json)
git add data/gospels.webce.json
```

**1. Apply the schema.** Supabase dashboard → SQL Editor → paste `supabase/schema.sql`
(or just the new `daily_reflections` block) → Run.

**2. Set env vars** (Vercel project settings):
| Var | New? | Notes |
|---|---|---|
| `CRON_SECRET` | ✅ new | any random string; Vercel auto-sends it as `Authorization: Bearer …` |
| `APP_BASE_URL` | optional | defaults to `https://blissfulcatholic.com` (used for the `/api/liturgy` self-fetch) |
| `ANTHROPIC_API_KEY` | reused | — |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` | reused | via `getSupabaseAdmin()` |

**3. Deploy.** The cron registers from `vercel.json` on deploy.

**4. Seed + verify.**
```bash
# Trigger once so today/+1/+2 rows exist (per-date status in the response):
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://blissfulcatholic.com/api/cron/daily-reflection
# → {"ok":true,"results":{"2026-06-23":"generated", "2026-06-24":"generated", ...}}

# Confirm the read endpoint returns the camelCase JSON the app expects:
curl "https://blissfulcatholic.com/api/daily-reflection?date=2026-06-23"
# → {"date":"...","gospelCitation":"...","body":"...","generatedAt":"..."}
```

Once that GET returns 200 with a body, the iOS side gets pointed at it
(DailyReflectionStore → fetch-by-date).

## Notes

- **Model/voice:** `claude-sonnet-4-6` + `FOUNDATION_SYSTEM_PROMPT`, matching the
  in-app `daily` feature, so the card and the companion read the same.
- **Append-by-date:** one row per day, `upsert` keyed on `date` → re-running the
  cron is idempotent and safe to trigger manually.
- **3-day window:** generating today + 2 means the row exists no matter the user's
  timezone at the midnight rollover (the cron runs on a single UTC clock).
- **Security:** `daily_reflections` has RLS enabled with no policy — only the
  service role touches it; the app reads through `/api/daily-reflection`, never
  Supabase directly.
