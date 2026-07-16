// Hand-picked 5×5 block patterns. Every template is 180°-rotationally
// symmetric (crossword convention) and has no slot shorter than 3.
//
// Every template here was validated empirically against the shipped dictionary
// (100/100 random-seed fills, see scripts/test-crossword-fill.ts). That gate is
// unforgiving: fully-checked 5×5 grids need a far larger word list than ~500
// purely Catholic entries, so most classic mini layouts (staircases, open
// corners) fill 0% and are excluded. Orientation matters too — double-corner
// fills 100% while its mirror image fills 0%, because letter-position
// statistics (which letters can start vs end a word) are not symmetric. Never
// add or flip a template without re-running the feasibility script.
//
// Feasibility isn't the only gate — solution DIVERSITY is too. The
// fully-checked double-corner layout filled 100% but only ever reached 4
// distinct grids (the same puzzle ~18×/year), so it was cut. Every template
// below produced 100+ distinct grids across 200 random seeds. All are
// interlock-style with some unchecked cells, which validate.ts permits as long
// as every white cell belongs to at least one slot. Slot inventory noted per
// template.

export type Template = {
  id: string;
  rows: string[]; // "#" = block, "." = white
};

export const TEMPLATES: Template[] = [
  {
    // 2×5, 4×3 — the only 3-slot host; keeps Latin glue + short feast names in play
    id: "diamond",
    rows: ["#...#", ".#.#.", ".....", ".#.#.", "#...#"],
  },
  {
    // 2×5, 4×4 — crisscross, hosts 4-letter feast names
    id: "crisscross-4a",
    rows: ["....#", ".#.#.", ".....", ".#.#.", "#...."],
  },
  {
    // 2×5, 4×4 — mirror of crisscross-4a (independently verified feasible)
    id: "crisscross-4b",
    rows: ["#....", ".#.#.", ".....", ".#.#.", "....#"],
  },
  {
    // 6×5 — densest interlock of the set
    id: "crisscross-6",
    rows: [".....", ".#.#.", ".....", ".#.#.", "....."],
  },
  {
    // 5×5 — lightest day: three across, two down
    id: "crisscross-5",
    rows: [".....", "#.#.#", ".....", "#.#.#", "....."],
  },
];

// The wide-open grid (ten 5s) is excluded from the launch set — enable only if
// scripts/test-crossword-fill.ts proves ≥99% fill success with it included.
export const OPEN_TEMPLATE: Template = {
  id: "open",
  rows: [".....", ".....", ".....", ".....", "....."],
};
