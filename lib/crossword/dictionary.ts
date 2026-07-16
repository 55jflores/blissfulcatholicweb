// Dictionary loading, linting, and the constraint index the filler queries.
// The word list itself lives in data/crossword-words.json — curated, reviewed
// once for doctrinal accuracy, and grown over time (never delete a shipped
// answer; see docs/daily-crossword.md).

import words from "@/data/crossword-words.json";
import type { DictEntry } from "./types";

export const KNOWN_TAGS = new Set([
  "saint",
  "marian",
  "angel",
  "sacrament",
  "liturgy",
  "latin",
  "bible",
  "doctrine",
  "pope",
  "place",
  "order",
  "advent",
  "christmas",
  "lent",
  "easter",
]);

export function loadDictionary(): DictEntry[] {
  return (words as { entries: DictEntry[] }).entries;
}

// Returns human-readable errors; empty array = clean. Run by generatePuzzle
// (fail loud, never ship a puzzle off a malformed dictionary) and by the
// feasibility script as a lint step.
export function validateDictionary(entries: DictEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  entries.forEach((e, i) => {
    const where = `entries[${i}] (${e.answer ?? "?"})`;
    if (!/^[A-Z]{3,5}$/.test(e.answer ?? "")) {
      errors.push(`${where}: answer must be A–Z, length 3–5`);
    }
    if (seen.has(e.answer)) errors.push(`${where}: duplicate answer`);
    seen.add(e.answer);

    if (!Array.isArray(e.clues) || e.clues.length === 0) {
      errors.push(`${where}: needs at least one clue`);
    } else if (e.clues.some((c) => typeof c !== "string" || c.trim().length === 0)) {
      errors.push(`${where}: empty clue`);
    }

    for (const tag of e.tags ?? []) {
      if (!KNOWN_TAGS.has(tag)) errors.push(`${where}: unknown tag "${tag}"`);
    }

    for (const fd of e.feastDates ?? []) {
      const m = /^(\d{2})-(\d{2})$/.exec(fd);
      const month = m ? Number(m[1]) : 0;
      const day = m ? Number(m[2]) : 0;
      if (!m || month < 1 || month > 12 || day < 1 || day > 31) {
        errors.push(`${where}: bad feastDate "${fd}" (want MM-DD)`);
      }
    }

    if (e.difficulty !== undefined && ![1, 2, 3].includes(e.difficulty)) {
      errors.push(`${where}: difficulty must be 1–3`);
    }
  });

  return errors;
}

export type DictIndex = {
  entries: DictEntry[];
  byAnswer: Map<string, DictEntry>;
  byLength: Map<number, string[]>;
  // `${length}:${position}:${letter}` → answers, for O(1) crossing lookups.
  byConstraint: Map<string, string[]>;
};

export function buildIndex(entries: DictEntry[]): DictIndex {
  const byAnswer = new Map<string, DictEntry>();
  const byLength = new Map<number, string[]>();
  const byConstraint = new Map<string, string[]>();

  for (const e of entries) {
    byAnswer.set(e.answer, e);
    const len = e.answer.length;
    if (!byLength.has(len)) byLength.set(len, []);
    byLength.get(len)!.push(e.answer);
    for (let pos = 0; pos < len; pos++) {
      const key = `${len}:${pos}:${e.answer[pos]}`;
      if (!byConstraint.has(key)) byConstraint.set(key, []);
      byConstraint.get(key)!.push(e.answer);
    }
  }
  return { entries, byAnswer, byLength, byConstraint };
}

// Candidate answers for a slot pattern like "P..A." ("." = empty cell),
// excluding already-used words. Starts from the smallest constraint list
// (or byLength when the slot is empty), then verifies the full pattern.
export function candidates(index: DictIndex, pattern: string, used: Set<string>): string[] {
  const len = pattern.length;
  let pool: string[] | undefined;

  for (let pos = 0; pos < len; pos++) {
    const ch = pattern[pos];
    if (ch === ".") continue;
    const list = index.byConstraint.get(`${len}:${pos}:${ch}`) ?? [];
    if (!pool || list.length < pool.length) pool = list;
    if (pool.length === 0) return [];
  }
  pool ??= index.byLength.get(len) ?? [];

  return pool.filter((answer) => {
    if (used.has(answer)) return false;
    for (let pos = 0; pos < len; pos++) {
      const ch = pattern[pos];
      if (ch !== "." && answer[pos] !== ch) return false;
    }
    return true;
  });
}
