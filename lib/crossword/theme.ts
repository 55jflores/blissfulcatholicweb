// Liturgical theming: on a saint's feast day, seed the puzzle with that saint's
// dictionary entries; otherwise fall back to season-tagged vocabulary (Advent,
// Christmas, Lent, Easter). Imports romcal directly (same calendarFor + year
// cache as app/api/liturgy/route.ts) rather than self-fetching, so the local
// preview scripts work offline and prod generates byte-identical puzzles.
//
// Theming is best-effort by contract: any romcal hiccup returns null and the
// puzzle still generates, just unthemed.

import romcal from "romcal";
import type { DictEntry } from "./types";

type RomcalDay = {
  moment: string;
  type: string; // SOLEMNITY | FEAST | MEMORIAL | OPT_MEMORIAL | FERIA | …
  name: string;
  data?: { season?: { key: string; value: string } };
};

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

// romcal v1.3 season keys are Title Case with spaces ("Advent",
// "Christmastide", "Holy Week", "Later Ordinary Time") — normalize to
// UPPER_SNAKE before matching so either shape works.
const SEASON_TAG: Record<string, string> = {
  ADVENT: "advent",
  CHRISTMASTIDE: "christmas",
  LENT: "lent",
  HOLY_WEEK: "lent",
  EASTER: "easter",
  EASTERTIDE: "easter",
};

const normalizeSeasonKey = (key: string) => key.toUpperCase().replace(/\s+/g, "_");

const SEASON_LABEL: Record<string, string> = {
  advent: "Advent",
  christmas: "Christmas",
  lent: "Lent",
  easter: "Eastertide",
};

export type ThemeCandidates = {
  kind: "feast" | "season";
  entries: DictEntry[]; // seed priority order
  label: string;
  note: string;
};

export async function pickThemeCandidates(
  date: string,
  entries: DictEntry[]
): Promise<ThemeCandidates | null> {
  let day: RomcalDay | undefined;
  try {
    const cal = await calendarForYear(Number(date.slice(0, 4)));
    day = cal.find((d) => String(d.moment).slice(0, 10) === date);
  } catch {
    day = undefined;
  }

  // Feast match: dictionary entries carrying today's MM-DD, confirmed by romcal
  // actually keeping that celebration. Allowlist of celebration types — a plain
  // Sunday outranks a memorial (St. Anne on a Sunday is NOT celebrated that
  // year), and labeling the puzzle "honors 17th Sunday of Ordinary Time" would
  // be nonsense.
  const CELEBRATION_TYPES = new Set(["SOLEMNITY", "FEAST", "MEMORIAL", "OPT_MEMORIAL"]);
  const mmdd = date.slice(5);
  const feastEntries = entries.filter((e) => e.feastDates?.includes(mmdd));
  if (feastEntries.length > 0 && day && CELEBRATION_TYPES.has(day.type)) {
    return {
      kind: "feast",
      // Longer answers first: a 5-letter saint name is a stronger theme anchor
      // than 3-letter glue.
      entries: [...feastEntries].sort((a, b) => b.answer.length - a.answer.length),
      label: day.name,
      note: `Today's puzzle honors ${day.name}, whose feast the Church keeps today.`,
    };
  }

  // Season match.
  const tag = day?.data?.season?.key ? SEASON_TAG[normalizeSeasonKey(day.data.season.key)] : undefined;
  if (tag) {
    const seasonal = entries.filter((e) => e.tags.includes(tag));
    if (seasonal.length > 0) {
      const label = SEASON_LABEL[tag];
      return {
        kind: "season",
        entries: seasonal,
        label,
        note: `Today's puzzle is woven with the words of ${label}.`,
      };
    }
  }

  return null;
}
