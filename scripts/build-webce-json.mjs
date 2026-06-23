// Parses the WEBCE USFM source (eBible.org / public domain) into a clean
// verse-keyed JSON suitable for bundling in the iOS app.
//
// Input:  scripts/data/eng-web-c_usfm.zip   (committed source — 73 books)
// Output: scripts/_webce-build/webce.json   (gitignored build artifact)
//
// Shape: { books: [ { code, name, chapters: { N: { N: "verse text", … } } } ] }
//
// Run with `node scripts/build-webce-json.mjs` whenever the source updates;
// then copy the JSON into the iOS app's Resources.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ZIP = path.join(__dirname, "data", "eng-web-c_usfm.zip");
const OUT_DIR = path.join(__dirname, "_webce-build");
const SRC_DIR = path.join(OUT_DIR, "usfm");
const OUT_FILE = path.join(OUT_DIR, "webce.json");

// Unzip the source on every run — fast (~50 ms) and guarantees the working
// USFM matches the committed zip.
function ensureSource() {
  fs.mkdirSync(SRC_DIR, { recursive: true });
  execSync(`unzip -q -o "${SRC_ZIP}" -d "${SRC_DIR}"`);
}

/** Strip USFM inline markup, keeping the displayable text. */
function cleanVerseText(raw) {
  let s = raw;

  // Drop footnotes (\f … \f*), cross-references (\x … \x*), figures, alt footnotes.
  // These nest occasionally, but eBible's WEBCE doesn't nest \f, so a non-greedy
  // pattern is safe here.
  s = s.replace(/\\f\s+[\s\S]*?\\f\*/g, "");
  s = s.replace(/\\fe\s+[\s\S]*?\\fe\*/g, "");
  s = s.replace(/\\x\s+[\s\S]*?\\x\*/g, "");
  s = s.replace(/\\fig\s[\s\S]*?\\fig\*/g, "");

  // Word markers — handle BOTH \w…\w*  AND  \+w…\+w* (the `+` form is used
  // when nested inside another marker like \wj). Capture the word, drop |attrs.
  s = s.replace(/\\\+?w\s+([^|\\]*?)(?:\|[^\\]*)?\\\+?w\*/g, "$1");

  // Other inline markers that wrap displayed text: keep the inner text.
  //   \wj = words of Jesus; \nd = divine name; \add = added words; etc.
  s = s.replace(
    /\\\+?(?:wj|nd|add|bk|sc|em|it|bd|bdit|no|sup|rq|qac|tl|pn|qs)\s+([^\\]*?)\\\+?(?:wj|nd|add|bk|sc|em|it|bd|bdit|no|sup|rq|qac|tl|pn|qs)\*/g,
    "$1"
  );

  // Any remaining USFM markers (paragraph/poetry/etc.) → drop the marker tag.
  // Format: \tag args  or  \tag\*  — replace with a space.
  s = s.replace(/\\[a-zA-Z0-9+]+\*?/g, " ");

  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/** Friendly book name from \h (running header) or \toc1 / \toc2. */
function extractName(text) {
  const h = text.match(/\\h\s+([^\r\n]+)/);
  if (h) return h[1].trim();
  const t2 = text.match(/\\toc2\s+([^\r\n]+)/);
  if (t2) return t2[1].trim();
  return null;
}

/** Parse one USFM book file → { code, name, chapters }. */
function parseBook(filePath) {
  const filename = path.basename(filePath);
  // "02-GENeng-web-c.usfm" → "GEN"
  const codeMatch = filename.match(/^\d+-([A-Z0-9]+)eng-web-c\.usfm$/);
  if (!codeMatch) {
    throw new Error(`Unrecognized filename: ${filename}`);
  }
  const code = codeMatch[1];
  const text = fs.readFileSync(filePath, "utf8");
  const name = extractName(text) ?? code;

  // Split on \c (chapter). Anything before the first \c is front matter (skip).
  const parts = text.split(/\\c\s+/);
  parts.shift();

  const chapters = {};
  for (const part of parts) {
    // First token is the chapter number, rest is the chapter body.
    const chapMatch = part.match(/^(\d+)([\s\S]*)$/);
    if (!chapMatch) continue;
    const chap = parseInt(chapMatch[1], 10);
    const body = chapMatch[2];

    // Split chapter body on \v N
    const verseParts = body.split(/\\v\s+/);
    verseParts.shift();
    const verses = {};
    for (const vp of verseParts) {
      const vm = vp.match(/^(\d+[a-z]?)([\s\S]*?)(?=\\v\s+\d|$)/);
      if (!vm) continue;
      // Strip alpha suffix on the verse number (1a → 1) since lectionary citations
      // sometimes use them and we want a single key.
      const vnum = parseInt(vm[1], 10);
      const cleaned = cleanVerseText(vm[2]);
      if (!cleaned) continue;
      // If the verse already exists (split parts like 1a/1b), join them.
      verses[vnum] = verses[vnum] ? verses[vnum] + " " + cleaned : cleaned;
    }
    chapters[chap] = verses;
  }

  return { code, name, chapters };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  ensureSource();
  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".usfm"))
    .map((f) => path.join(SRC_DIR, f))
    .sort();

  const books = [];
  for (const f of files) {
    const book = parseBook(f);
    const chapterCount = Object.keys(book.chapters).length;
    const verseCount = Object.values(book.chapters).reduce(
      (sum, c) => sum + Object.keys(c).length,
      0
    );
    books.push(book);
    console.log(
      `${book.code.padEnd(5)} ${book.name.padEnd(35)} ${String(chapterCount).padStart(3)} ch · ${String(verseCount).padStart(5)} v`
    );
  }

  const out = {
    translation: "WEB-CE",
    name: "World English Bible (Catholic Edition)",
    license: "Public Domain",
    source: "https://ebible.org/eng-web-c/",
    books,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  const stats = fs.statSync(OUT_FILE);
  console.log(`\nWrote ${OUT_FILE} (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${books.length} books)`);

  // Gospels-only subset (~480 KB) for the web backend's daily-reflection cron.
  // Same source of truth as the iOS bundle, so it can't drift. COMMIT this file
  // (data/ is not gitignored) — the cron imports it at build time.
  const gospels = {
    books: books.filter((b) => ["MAT", "MRK", "LUK", "JHN"].includes(b.code)),
  };
  const GOSPELS_FILE = path.join(__dirname, "..", "data", "gospels.webce.json");
  fs.mkdirSync(path.dirname(GOSPELS_FILE), { recursive: true });
  fs.writeFileSync(GOSPELS_FILE, JSON.stringify(gospels));
  const gStats = fs.statSync(GOSPELS_FILE);
  console.log(`Wrote ${GOSPELS_FILE} (${(gStats.size / 1024).toFixed(0)} KB, Gospels-only — git add this)`);
}

main();
