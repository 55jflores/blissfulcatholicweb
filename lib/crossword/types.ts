// Shared types for the daily mini-crossword engine. The `Puzzle` shape is the
// exact payload stored in daily_crosswords.puzzle (jsonb) and served verbatim
// by /api/daily-crossword — iOS's DailyCrossword model mirrors it field-for-field.

export type Direction = "across" | "down";

export type Cell = { row: number; col: number };

// A run of white cells in the grid that must hold a dictionary word.
export type Slot = {
  id: string; // "A1", "D3" — direction letter + clue number
  dir: Direction;
  number: number;
  row: number;
  col: number;
  length: number;
  cells: Cell[];
};

export type DictEntry = {
  answer: string; // A–Z only, length 3–5
  clues: string[]; // 1+ variants; the generator picks one per puzzle
  tags: string[];
  feastDates?: string[]; // "MM-DD" — drives saint-day theme seeding
  difficulty?: number; // 1 easy … 3 hard
};

export type PuzzleClue = {
  number: number;
  row: number;
  col: number;
  length: number;
  clue: string;
  answer: string;
};

export type PuzzleTheme = {
  label: string; // e.g. "St. Bonaventure" or "Advent"
  note: string; // gentle sentence shown on the completion card
};

export type Puzzle = {
  date: string; // YYYY-MM-DD
  size: number; // 5
  rows: string[]; // solution rows; "#" = block
  clues: { across: PuzzleClue[]; down: PuzzleClue[] };
  theme: PuzzleTheme | null;
  generatedAt: string; // ISO-8601
};
