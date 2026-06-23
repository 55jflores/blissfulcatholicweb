// Gospel citation → verse text resolver.
// Faithful TypeScript port of the iOS app's CitationParser.swift + the
// BibleService `resolve` logic. Gospels only (Matthew/Mark/Luke/John),
// since the daily reflection is always grounded in the day's Gospel.
//
// Handles: en/em dashes, periods in abbreviations, missing spaces,
// verse-letter suffixes ("7:6a" -> "7:6"), comma-separated disjoint
// citations ("Matthew 7:6, 12-14" -> 7:6 + 7:12-14), and chapter spans.

export type GospelsJson = {
  books: {
    code: string;
    name: string;
    chapters: Record<string, Record<string, string>>; // chapter -> verse -> text
  }[];
};

interface Ref {
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number; // INT_MAX = "to end of chapter"
}

const INT_MAX = Number.MAX_SAFE_INTEGER;

// Lowercased, dot-free. Longest match wins (so "matthew" beats "matt" beats "mt").
const BOOK_NAMES: [string, string][] = (
  [
    ["matthew", "MAT"], ["matt", "MAT"], ["mt", "MAT"],
    ["mark", "MRK"], ["mrk", "MRK"], ["mk", "MRK"],
    ["luke", "LUK"], ["lk", "LUK"],
    ["john", "JHN"], ["jn", "JHN"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

function matchBook(lower: string): { code: string; len: number } | null {
  for (const [name, code] of BOOK_NAMES) {
    if (!lower.startsWith(name)) continue;
    if (lower.length === name.length) return { code, len: name.length };
    const next = lower[name.length];
    if (next === " " || /[0-9]/.test(next)) return { code, len: name.length };
  }
  return null;
}

function parseChapterVerse(
  s: string,
  defaultChapter: number | null
): { chapter: number | null; verse: number | null } {
  const cleaned = s.replace(/ /g, "");
  if (cleaned.includes(":")) {
    const [c, v = ""] = cleaned.split(":");
    const chap = parseInt(c.replace(/[^0-9]/g, ""), 10);
    const verseDigits = v.match(/^[0-9]+/);
    return {
      chapter: isNaN(chap) ? null : chap,
      verse: verseDigits ? parseInt(verseDigits[0], 10) : null,
    };
  }
  const n = cleaned.match(/^[0-9]+/);
  const num = n ? parseInt(n[0], 10) : null;
  if (defaultChapter !== null) return { chapter: defaultChapter, verse: num };
  return { chapter: num, verse: null };
}

function parseRangePart(part: string, book: string, carriedChapter: number | null): Ref | null {
  const sides = part.split("-");
  const lhs = sides[0];
  const rhs = sides.length > 1 ? sides.slice(1).join("-") : lhs;

  const a = parseChapterVerse(lhs, carriedChapter);
  const b = parseChapterVerse(rhs, a.chapter ?? carriedChapter);

  // Whole-chapter reference (no verse on either side)
  if (a.verse === null && b.verse === null) {
    if (a.chapter === null) return null;
    const ec = b.chapter ?? a.chapter;
    return { book, startChapter: a.chapter, startVerse: 1, endChapter: ec, endVerse: INT_MAX };
  }
  if (a.chapter === null) return null;
  const ec = b.chapter ?? a.chapter;
  const sv = a.verse ?? 1;
  const ev = b.verse ?? sv;
  return { book, startChapter: a.chapter, startVerse: sv, endChapter: ec, endVerse: ev };
}

function parse(citation: string): Ref[] {
  const normalized = citation.replace(/[–—]/g, "-").replace(/\./g, "").trim();
  const lower = normalized.toLowerCase();
  const m = matchBook(lower);
  if (!m) return [];

  const spec = normalized.slice(m.len).trim();
  if (!spec) return [];

  const parts = spec.split(",").map((p) => p.trim());
  const refs: Ref[] = [];
  let carried: number | null = null; // Gospels have no single-chapter books
  for (const part of parts) {
    const ref = parseRangePart(part, m.code, carried);
    if (ref) {
      refs.push(ref);
      carried = ref.endChapter;
    }
  }
  return refs;
}

/** Resolve a Gospel citation string into its verse text, joined with spaces. */
export function resolveGospel(citation: string, gospels: GospelsJson): string {
  const refs = parse(citation);
  if (refs.length === 0) return "";

  const out: string[] = [];
  for (const ref of refs) {
    const book = gospels.books.find((b) => b.code === ref.book);
    if (!book) continue;

    const chapNums = Object.keys(book.chapters).map(Number).filter((n) => !isNaN(n));
    const lastChap = chapNums.length ? Math.max(...chapNums) : ref.endChapter;
    const endChap = Math.min(ref.endChapter, lastChap);
    if (ref.startChapter > endChap) continue;

    for (let chap = ref.startChapter; chap <= endChap; chap++) {
      const verses = book.chapters[String(chap)];
      if (!verses) continue;
      const verseNums = Object.keys(verses).map(Number).filter((n) => !isNaN(n)).sort((x, y) => x - y);
      const startV = chap === ref.startChapter ? ref.startVerse : 1;
      const endV = chap === ref.endChapter ? ref.endVerse : INT_MAX;
      for (const vn of verseNums) {
        if (vn >= startV && vn <= endV) {
          const t = verses[String(vn)];
          if (t) out.push(t);
        }
      }
    }
  }
  return out.join(" ");
}
