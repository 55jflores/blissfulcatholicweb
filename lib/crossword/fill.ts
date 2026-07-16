// Backtracking grid filler. Deterministic given (template, dictionary, rng):
// MRV slot ordering (fewest candidates first), rng-shuffled candidate order,
// no duplicate answers, shared step budget so a hopeless grid fails fast and
// the caller falls through to the next template.

import type { DictEntry } from "./types";
import type { Slot } from "./types";
import type { Template } from "./templates";
import { extractSlots } from "./slots";
import { candidates, type DictIndex } from "./dictionary";
import { shuffle, type Rng } from "./rng";

export type FillResult = {
  grid: string[][]; // "#" for blocks, A–Z letters everywhere else
  assignments: Map<string, string>; // slot id → answer
  seedAnswer: string | null; // the theme entry that landed, if any
};

export type FillOptions = {
  // Theme candidates in priority order; the filler tries to build a grid
  // around each before giving up on theming. The fill still succeeds
  // (seedAnswer: null) if no seed fits.
  seedEntries?: DictEntry[];
  maxSteps?: number;
};

export function fillGrid(
  template: Template,
  index: DictIndex,
  rng: Rng,
  opts: FillOptions = {}
): FillResult | null {
  const { seedEntries = [], maxSteps = 50_000 } = opts;
  const slots = extractSlots(template.rows);
  const size = template.rows.length;

  let grid: string[][] = [];
  const resetGrid = () => {
    grid = template.rows.map((row) => row.split("").map((ch) => (ch === "#" ? "#" : "")));
  };

  const patternFor = (slot: Slot) =>
    slot.cells.map((c) => grid[c.row][c.col] || ".").join("");

  // Writes a word into a slot; returns the cells it changed so backtracking
  // restores only what this placement wrote (crossing letters stay put).
  const place = (slot: Slot, word: string): { row: number; col: number }[] => {
    const changed: { row: number; col: number }[] = [];
    slot.cells.forEach((cell, i) => {
      if (grid[cell.row][cell.col] === "") {
        grid[cell.row][cell.col] = word[i];
        changed.push(cell);
      }
    });
    return changed;
  };
  const unplace = (changed: { row: number; col: number }[]) => {
    for (const cell of changed) grid[cell.row][cell.col] = "";
  };

  let steps = 0;

  const solve = (assignments: Map<string, string>, used: Set<string>): boolean => {
    if (assignments.size === slots.length) return true;

    // MRV: the unfilled slot with the fewest live candidates.
    let best: Slot | null = null;
    let bestCands: string[] | null = null;
    for (const slot of slots) {
      if (assignments.has(slot.id)) continue;
      const cands = candidates(index, patternFor(slot), used);
      if (!bestCands || cands.length < bestCands.length) {
        best = slot;
        bestCands = cands;
      }
      if (cands.length === 0) break; // dead end — fail immediately
    }
    if (!best || !bestCands || bestCands.length === 0) return false;

    for (const word of shuffle(bestCands, rng)) {
      if (++steps > maxSteps) return false;
      const changed = place(best, word);
      assignments.set(best.id, word);
      used.add(word);
      if (solve(assignments, used)) return true;
      unplace(changed);
      assignments.delete(best.id);
      used.delete(word);
    }
    return false;
  };

  // Seeded attempts first: pin the theme word into a fitting slot, solve the rest.
  for (const entry of seedEntries) {
    if (entry.answer.length > size) continue;
    const fitting = slots.filter((s) => s.length === entry.answer.length);
    for (const slot of shuffle(fitting, rng)) {
      if (steps > maxSteps) break;
      resetGrid();
      place(slot, entry.answer);
      const assignments = new Map<string, string>([[slot.id, entry.answer]]);
      const used = new Set<string>([entry.answer]);
      if (solve(assignments, used)) {
        return { grid, assignments, seedAnswer: entry.answer };
      }
    }
  }

  // Unseeded fallback.
  resetGrid();
  const assignments = new Map<string, string>();
  const used = new Set<string>();
  if (solve(assignments, used)) return { grid, assignments, seedAnswer: null };
  return null;
}
