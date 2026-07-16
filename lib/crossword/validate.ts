// Structural + dictionary validation of a finished puzzle. generatePuzzle runs
// this on its own output and throws on any error — a malformed puzzle must
// never reach the table.

import type { Puzzle, PuzzleClue, Slot } from "./types";
import { extractSlots } from "./slots";
import type { DictIndex } from "./dictionary";

export function validatePuzzle(puzzle: Puzzle, index: DictIndex): string[] {
  const errors: string[] = [];
  const { size, rows } = puzzle;

  // Shape: size×size of A–Z letters and blocks.
  if (rows.length !== size) errors.push(`expected ${size} rows, got ${rows.length}`);
  for (const row of rows) {
    if (row.length !== size) errors.push(`row "${row}" is not length ${size}`);
    if (!/^[A-Z#]+$/.test(row)) errors.push(`row "${row}" has invalid characters`);
  }
  if (errors.length) return errors; // structural failures make the rest meaningless

  // 180° rotational symmetry of the block pattern.
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const mirrored = rows[size - 1 - r][size - 1 - c];
      if ((rows[r][c] === "#") !== (mirrored === "#")) {
        errors.push(`blocks not symmetric at (${r},${c})`);
      }
    }
  }

  const slots = extractSlots(rows);

  // Coverage: every white cell belongs to at least one slot (crisscross
  // templates leave some cells unchecked — that's allowed) and never to more
  // than one slot per direction.
  const coverage = new Map<string, { across: number; down: number }>();
  for (const slot of slots) {
    if (slot.length < 3) errors.push(`slot ${slot.id} is shorter than 3`);
    for (const cell of slot.cells) {
      const key = `${cell.row},${cell.col}`;
      const cov = coverage.get(key) ?? { across: 0, down: 0 };
      cov[slot.dir]++;
      coverage.set(key, cov);
    }
  }
  const whiteCells: { row: number; col: number }[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (rows[r][c] === "#") continue;
      whiteCells.push({ row: r, col: c });
      const cov = coverage.get(`${r},${c}`);
      if (!cov || cov.across + cov.down === 0) {
        errors.push(`cell (${r},${c}) belongs to no slot`);
      } else if (cov.across > 1 || cov.down > 1) {
        errors.push(`cell (${r},${c}) is in multiple ${cov.across > 1 ? "across" : "down"} slots`);
      }
    }
  }

  // Connectivity: all white cells reachable from the first one.
  if (whiteCells.length > 0) {
    const seen = new Set<string>([`${whiteCells[0].row},${whiteCells[0].col}`]);
    const queue = [whiteCells[0]];
    while (queue.length) {
      const { row, col } = queue.pop()!;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const r = row + dr;
        const c = col + dc;
        const key = `${r},${c}`;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        if (rows[r][c] === "#" || seen.has(key)) continue;
        seen.add(key);
        queue.push({ row: r, col: c });
      }
    }
    if (seen.size !== whiteCells.length) errors.push("white cells are not connected");
  }

  // Every slot's letters form a dictionary word; no answer repeats.
  const usedAnswers = new Set<string>();
  const wordAt = (slot: Slot) => slot.cells.map((c) => rows[c.row][c.col]).join("");
  for (const slot of slots) {
    const word = wordAt(slot);
    if (!index.byAnswer.has(word)) errors.push(`${slot.id} "${word}" not in dictionary`);
    if (usedAnswers.has(word)) errors.push(`answer "${word}" appears twice`);
    usedAnswers.add(word);
  }

  // Clues must mirror the derived slots exactly.
  const expect = (dir: "across" | "down", clues: PuzzleClue[]) => {
    const dirSlots = slots.filter((s) => s.dir === dir);
    if (clues.length !== dirSlots.length) {
      errors.push(`${dir}: expected ${dirSlots.length} clues, got ${clues.length}`);
      return;
    }
    for (const slot of dirSlots) {
      const clue = clues.find((c) => c.number === slot.number);
      if (!clue) {
        errors.push(`${dir} ${slot.number}: missing clue`);
        continue;
      }
      if (clue.row !== slot.row || clue.col !== slot.col || clue.length !== slot.length) {
        errors.push(`${dir} ${slot.number}: position/length mismatch`);
      }
      if (clue.answer !== wordAt(slot)) {
        errors.push(`${dir} ${slot.number}: answer "${clue.answer}" doesn't match grid`);
      }
      if (!clue.clue || clue.clue.trim().length === 0) {
        errors.push(`${dir} ${slot.number}: empty clue text`);
      }
    }
  };
  expect("across", puzzle.clues.across);
  expect("down", puzzle.clues.down);

  return errors;
}
