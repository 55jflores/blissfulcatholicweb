# scripts

One-off data prep and dev utilities. Most outputs are gitignored under `_*/`.

## `build-webce-json.mjs`

Builds `_webce-build/webce.json` — the iOS app's bundled Bible text — from the
committed WEBCE USFM source in `data/`.

```bash
node scripts/build-webce-json.mjs
```

**Source:** `data/eng-web-c_usfm.zip` — World English Bible, Catholic Edition,
from [eBible.org/eng-web-c/](https://ebible.org/eng-web-c/). **Public domain.**
73 books, deuterocanon included.

**Why this lives here:** the iOS app *bundles* the JSON; we keep the build
inputs and script in the web repo (where Node lives) so regeneration is
reproducible from version control. When the JSON changes, copy it into
`Blissful Catholic/Blissful Catholic/Resources/webce.json` in the iOS repo.

If you change the USFM source: drop the replacement zip at the same path, rerun,
spot-check (a small audit is baked into the script's output and a markup-leak
check is easy to extend), and copy the new JSON over.

## Other scripts in this folder

- `try-ai.ts` — single-turn Claude probe (skips auth/gating).
- `test-e2e.ts` — full pipeline test through `/api/ai` (signs up a throwaway user).
