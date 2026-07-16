// Entry point: generatePuzzle(date) → the payload stored in daily_crosswords.
// Deterministic given (date, dictionary version, avoid set) — everything
// random flows from createRng — except generatedAt, a timestamp by design.
//
// The avoid set exists because different dates can converge to the same fill:
// MRV search has attractor solutions, and theme seeding (a handful of Advent
// words pinned day after day) makes back-to-back identical grids a real
// occurrence (19/365 in testing). Callers pass the grids of recently shipped
// puzzles; on collision the rng is re-salted (date#1, date#2, …) and the day
// re-rolled, still fully deterministic for a given history.

import { TEMPLATES, type Template } from "./templates";
import { buildIndex, loadDictionary, validateDictionary, type DictIndex } from "./dictionary";
import { extractSlots } from "./slots";
import { fillGrid, type FillResult } from "./fill";
import { pickThemeCandidates, type ThemeCandidates } from "./theme";
import { validatePuzzle } from "./validate";
import { createRng, pick, shuffle, type Rng } from "./rng";
import type { Puzzle, PuzzleClue } from "./types";

export type GenerateOptions = {
  // Grids (rows joined with "/") of recently shipped puzzles to not repeat.
  avoid?: ReadonlySet<string>;
};

const MAX_SALTS = 8;

export async function generatePuzzle(date: string, opts: GenerateOptions = {}): Promise<Puzzle> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`generatePuzzle: bad date "${date}"`);
  }

  const entries = loadDictionary();
  const dictErrors = validateDictionary(entries);
  if (dictErrors.length > 0) {
    throw new Error(`crossword dictionary invalid:\n${dictErrors.join("\n")}`);
  }
  const index = buildIndex(entries);
  const theme = await pickThemeCandidates(date, entries); // null on any romcal hiccup

  let fallback: Puzzle | null = null;
  for (let salt = 0; salt < MAX_SALTS; salt++) {
    const rng = createRng(salt === 0 ? date : `${date}#${salt}`);
    const puzzle = attemptPuzzle(date, theme, index, rng);
    if (!puzzle) continue;
    if (!opts.avoid?.has(puzzle.rows.join("/"))) return puzzle;
    fallback ??= puzzle; // a repeated grid still beats a missing day
  }
  if (fallback) return fallback;

  throw new Error(
    `no template could be filled for ${date} — dictionary too thin? run scripts/test-crossword-fill.ts`
  );
}

function attemptPuzzle(
  date: string,
  theme: ThemeCandidates | null,
  index: DictIndex,
  rng: Rng
): Puzzle | null {
  // Feast seeds keep their priority order (longest/most distinctive first);
  // seasonal pools are large, so shuffle and cap to keep seed attempts cheap.
  const seedEntries =
    theme === null
      ? []
      : theme.kind === "feast"
        ? theme.entries
        : shuffle(theme.entries, rng).slice(0, 10);

  // Every launch template fills ~100%, so the first template tried wins. Bias
  // the shuffled order so templates that can actually host a seed word (a slot
  // of matching length) come first — otherwise a feast whose names are all
  // 3-letter would only be themed when the one 3-slot template shuffles first.
  // The sort is stable, so the shuffle still decides order within each group.
  const seedLengths = new Set(seedEntries.map((e) => e.answer.length));
  const canHostSeed = (t: Template) =>
    extractSlots(t.rows).some((s) => seedLengths.has(s.length));
  const templates = shuffle(TEMPLATES, rng);
  if (seedLengths.size > 0) {
    templates.sort((a, b) => Number(canHostSeed(b)) - Number(canHostSeed(a)));
  }

  for (const template of templates) {
    const result = fillGrid(template, index, rng, { seedEntries });
    if (!result) continue;

    const puzzle = toPuzzle(date, template, result, theme, index, rng);
    const errors = validatePuzzle(puzzle, index);
    if (errors.length > 0) {
      // An engine bug, not a data problem — refuse to ship it.
      throw new Error(`generated invalid puzzle for ${date}:\n${errors.join("\n")}`);
    }
    return puzzle;
  }

  return null;
}

function toPuzzle(
  date: string,
  template: Template,
  fill: FillResult,
  theme: ThemeCandidates | null,
  index: DictIndex,
  rng: Rng
): Puzzle {
  const rows = fill.grid.map((row) => row.join(""));
  const across: PuzzleClue[] = [];
  const down: PuzzleClue[] = [];

  for (const slot of extractSlots(template.rows)) {
    const answer = fill.assignments.get(slot.id)!;
    const entry = index.byAnswer.get(answer)!;
    const clue: PuzzleClue = {
      number: slot.number,
      row: slot.row,
      col: slot.col,
      length: slot.length,
      clue: pick(entry.clues, rng),
      answer,
    };
    (slot.dir === "across" ? across : down).push(clue);
  }
  across.sort((a, b) => a.number - b.number);
  down.sort((a, b) => a.number - b.number);

  return {
    date,
    size: template.rows.length,
    rows,
    clues: { across, down },
    // Theme only counts if a seed word actually landed in the grid.
    theme: theme && fill.seedAnswer ? { label: theme.label, note: theme.note } : null,
    generatedAt: new Date().toISOString(),
  };
}
