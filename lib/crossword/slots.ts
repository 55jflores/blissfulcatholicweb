// Slot extraction + standard crossword numbering over a block template.

import type { Cell, Slot } from "./types";

const BLOCK = "#";

function isWhite(rows: string[], row: number, col: number): boolean {
  return (
    row >= 0 &&
    row < rows.length &&
    col >= 0 &&
    col < rows[row].length &&
    rows[row][col] !== BLOCK
  );
}

// Standard numbering: scan row-major; a cell gets the next number if it starts
// an across slot (no white cell to its left, white to its right) and/or a down
// slot (none above, white below). Both slots starting at one cell share the
// number — exactly how printed crosswords number.
export function extractSlots(rows: string[]): Slot[] {
  const slots: Slot[] = [];
  let nextNumber = 1;

  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      if (!isWhite(rows, row, col)) continue;

      const startsAcross = !isWhite(rows, row, col - 1) && isWhite(rows, row, col + 1);
      const startsDown = !isWhite(rows, row - 1, col) && isWhite(rows, row + 1, col);
      if (!startsAcross && !startsDown) continue;

      const number = nextNumber++;
      if (startsAcross) {
        const cells: Cell[] = [];
        for (let c = col; isWhite(rows, row, c); c++) cells.push({ row, col: c });
        slots.push({ id: `A${number}`, dir: "across", number, row, col, length: cells.length, cells });
      }
      if (startsDown) {
        const cells: Cell[] = [];
        for (let r = row; isWhite(rows, r, col); r++) cells.push({ row: r, col });
        slots.push({ id: `D${number}`, dir: "down", number, row, col, length: cells.length, cells });
      }
    }
  }
  return slots;
}

export type Crossing = {
  posInSlot: number;
  otherId: string;
  posInOther: number;
};

// For each slot, where each of its cells is crossed by the perpendicular slot.
// In a fully-checked grid every cell of every slot has exactly one crossing.
export function computeCrossings(slots: Slot[]): Map<string, Crossing[]> {
  // "row,col" → the slot+position occupying that cell, per direction.
  const at = new Map<string, { id: string; pos: number }[]>();
  for (const slot of slots) {
    slot.cells.forEach((cell, pos) => {
      const key = `${cell.row},${cell.col}`;
      const list = at.get(key) ?? [];
      list.push({ id: slot.id, pos });
      at.set(key, list);
    });
  }

  const crossings = new Map<string, Crossing[]>();
  for (const slot of slots) {
    const list: Crossing[] = [];
    slot.cells.forEach((cell, pos) => {
      const occupants = at.get(`${cell.row},${cell.col}`) ?? [];
      for (const o of occupants) {
        if (o.id !== slot.id) list.push({ posInSlot: pos, otherId: o.id, posInOther: o.pos });
      }
    });
    crossings.set(slot.id, list);
  }
  return crossings;
}
