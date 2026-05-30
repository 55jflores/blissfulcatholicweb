// Liturgical calendar layer. Computes the day's liturgical info (season, color,
// celebration/saint, rank) with romcal — pure calendar *facts*, no copyright and
// no external API. Reading citations + scripture text are layered on later.
//
// Public + cacheable (no auth) — the data is identical for everyone on a given
// date, and signed-out users still get a real "today" (local-first).

import romcal from "romcal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RomcalDay = {
  moment: string;
  type: string; // rank: SOLEMNITY | FEAST | MEMORIAL | OPT_MEMORIAL | FERIA | …
  name: string;
  data?: {
    season?: { key: string; value: string };
    meta?: {
      liturgicalColor?: { key: string; value: string };
      cycle?: { key: string; value: string };
    };
  };
};

// romcal computes a full year deterministically — cache each year in-process so
// repeated requests don't recompute.
const yearCache = new Map<number, RomcalDay[]>();

async function calendarForYear(year: number): Promise<RomcalDay[]> {
  const cached = yearCache.get(year);
  if (cached) return cached;
  const cal = (await romcal.calendarFor({
    year,
    country: "unitedStates",
    locale: "en",
  })) as RomcalDay[];
  yearCache.set(year, cal);
  return cal;
}

// ---------------------------------------------------------------------------
// Reading citations
//
// The day's lectionary citations come from cpbjr.github.io/catholic-readings-api,
// which returns the reading references as plain strings (no bundled scripture
// text). We accept *only* the citation strings here — if the upstream shape ever
// changes to include text, this code still extracts citations only and ignores
// the rest. iOS resolves citations against bundled WEBCE locally.

type ReadingCitation = { label: string; citation: string };

const READING_LABELS: Record<string, string> = {
  firstReading: "First Reading",
  psalm: "Responsorial Psalm",
  secondReading: "Second Reading",
  gospel: "Gospel",
};
const READING_KEYS = ["firstReading", "psalm", "secondReading", "gospel"] as const;

// Per-date cache for warm functions (the upstream is small + deterministic).
const readingsCache = new Map<string, ReadingCitation[] | null>();

async function fetchReadings(date: string): Promise<ReadingCitation[] | null> {
  if (readingsCache.has(date)) return readingsCache.get(date) ?? null;

  const [yyyy, mm, dd] = date.split("-");
  const url = `https://cpbjr.github.io/catholic-readings-api/readings/${yyyy}/${mm}-${dd}.json`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      readingsCache.set(date, null);
      return null;
    }
    const data = (await res.json()) as { readings?: Record<string, unknown> };
    const r = data?.readings;
    if (!r || typeof r !== "object") {
      readingsCache.set(date, null);
      return null;
    }

    const readings: ReadingCitation[] = [];
    for (const key of READING_KEYS) {
      const citation = r[key];
      if (typeof citation === "string" && citation.trim().length > 0) {
        readings.push({ label: READING_LABELS[key], citation: citation.trim() });
      }
    }
    const result = readings.length > 0 ? readings : null;
    readingsCache.set(date, result);
    return result;
  } catch {
    // Network / timeout / parse failure — return null and let the rest of the
    // calendar payload still serve.
    return null;
  }
}

export async function GET(req: Request) {
  const date =
    new URL(req.url).searchParams.get("date") ??
    new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC fallback; iOS sends its local date)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: "bad_request", message: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  // Calendar + readings in parallel (independent upstreams).
  const [cal, readings] = await Promise.all([
    calendarForYear(Number(date.slice(0, 4))),
    fetchReadings(date),
  ]);
  const day = cal.find((d) => String(d.moment).slice(0, 10) === date);
  if (!day) {
    return Response.json(
      { error: "not_found", message: "No liturgical day for that date." },
      { status: 404 }
    );
  }

  return Response.json(
    {
      date,
      celebration: day.name,
      rank: day.type,
      season: day.data?.season?.value ?? null,
      seasonKey: day.data?.season?.key ?? null,
      color: day.data?.meta?.liturgicalColor?.key ?? null, // e.g. "GREEN"
      colorHex: day.data?.meta?.liturgicalColor?.value ?? null,
      cycle: day.data?.meta?.cycle?.value ?? null,
      readings, // null if the upstream is unreachable or has no data for the date
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}
