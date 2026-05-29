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

  const cal = await calendarForYear(Number(date.slice(0, 4)));
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
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}
