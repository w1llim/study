# CLAUDE.md

Guidance for Claude Code when working in this repo — including adding a **new subject**
(this app is not limited to Enterprise Computing and Software Engineering; any subject
with multiple-choice questions works).

## What this is

An offline-first PWA for revising HSC multiple-choice question banks. Vanilla HTML/CSS/JS,
no framework, no bundler. See `README.md` for the full architecture, data model and
troubleshooting — read it before making changes. The short version:

- `data/index.json` is the catalogue: subjects → modules → topics → file paths.
- `data/<subject>-<module>.json` holds one module's questions.
- `js/bank.js`, `js/app.js`, `js/quiz.js`, `js/store.js` are entirely **data-driven** —
  they iterate `index.json.subjects` generically. Nothing in the app code hardcodes EC/SE,
  so a new subject only needs new data files plus the small hand-authored spots below.
- `tools/build-bank.mjs` generates everything under `data/` from Obsidian notes. It is
  config-driven: each subject is an entry in its `SUBJECTS` array with a `source` path and a
  `shape` describing how many modules, how many questions per module, and whether the note is
  authored as `Set A` / `Set B` pairs to be combined. It rebuilds `data/index.json` from that
  array, so **every subject must be listed there** — anything added to `index.json` by hand is
  overwritten on the next run.

## Adding a new subject

1. **Pick an id and short code**, e.g. `id: "bio"`, `short: "BIO"`. Lowercase, no spaces —
   it becomes part of filenames and URL hashes (`#/m/bio/1`).

2. **Write the question bank as an Obsidian note** in the grammar the parser expects
   (documented at the top of `tools/build-bank.mjs` and in `README.md` → "What the parser
   expects"):

   ```
   # Module <n> — <name> (Q<a>–Q<b>)      <- en dash
   ## <topic>
   **Q<n>** <stem on one line>
   (A) ... (B) ... (C) ... (D) ...        <- 1, 2 or 4 lines

   > [!success]- Answer
   >
   > **(X).** <explanation on one line>
   ```

   Rules the app and progress-tracking assume — the build script asserts all of these, so a
   violation aborts the build with a `file:line` rather than shipping a broken bank:
   - Question numbers are contiguous **across the whole subject**, starting at 1 (module 2
     continues where module 1 left off).
   - Exactly 4 options, in A–D order, and an answer letter in A–D.
   - Module count and per-module question count match the subject's declared `shape`.

   Inline `**bold**`, `*italic*` and `` `code` `` are converted; everything else is escaped
   before being inserted via `innerHTML`, so question text is safe by construction. Never
   reorder options after writing an explanation that names a distractor by letter.

3. **Add the subject to `SUBJECTS` in `tools/build-bank.mjs`** and run it:

   ```js
   {
     id: 'bio',
     name: 'Biology',
     short: 'BIO',
     source: join(VAULT, 'Biology', 'Bio Question Bank.md'),
     shape: { combineSets: false, modules: 8, perModule: 25 },
   }
   ```

   `combineSets: true` is the EC/SE case — the note holds twice as many `# Module` sections,
   authored as `Set A` / `Set B` pairs with sizes given by `setSizes: [100, 150]`, which the
   script merges pairwise. For anything simpler use `combineSets: false` with `perModule`.

   ```bash
   node tools/build-bank.mjs
   ```

   That writes `data/bio-*.json` and regenerates `data/index.json` (subjects, modules, counts,
   deduplicated topic lists, and a fresh `version` date). Nothing under `data/` is hand-authored.

4. **Register the new data files with the service worker** — `sw.js`'s `PRECACHE` array
   lists every file needed for offline use. Add `data/bio-1.json` etc., and **bump `CACHE`**
   (`study-vN` → `study-vN+1`) so installed copies pick up the new files — see the
   "Deploying" section of `README.md`.

5. **Add the subject's colour to `css/styles.css`** — theming is keyed by subject id. Add a
   `--bio` / `--bio-soft` pair to each of the four colour blocks (light `:root`, the
   `prefers-color-scheme: dark` media query, and the two `[data-theme]` overrides), then a
   `[data-subject="bio"]` rule beside each existing `ec`/`se` pair (`.subject`, `.start-card`,
   `.quiz`, `.score-hero`). Without this the subject falls back to the default text colour.

6. **Optional cosmetic touch-ups** — hand-authored copy naming the subjects:
   `index.html`'s `<title>` and `<meta name="description">`, `js/app.js`'s home-screen lede and
   its total question count, and `README.md`'s intro.

7. **Test locally** before committing — `python -m http.server 8000`, then open
   `http://localhost:8000/#/m/<id>/1` and run through a session. Confirm the module shows
   up on the home screen, questions render, answering records progress, and results/review
   work.

## Deployment

Vercel serves <https://study.willim.tech> from the repository root on every push to `main`
(project `study`, team `we-are-vibe-coding`). GitHub Pages is not used.

**There is no build step, and there must not be one.** `vercel.json` sets `buildCommand: null`
and `outputDirectory: "."`. `tools/build-bank.mjs` reads Obsidian notes from an absolute path on
the author's machine, so wiring it into a `build` script fails every deployment with `ENOENT` —
this has happened once already. `data/*.json` is generated locally and committed; that is the
whole reason the generated files are in version control.

## Conventions to preserve

- Never hand-edit anything under `data/` — every file there, `index.json` included, is
  generated by `tools/build-bank.mjs` from the Obsidian source notes named in `README.md`, and
  a manual edit is silently overwritten on the next regeneration. Fix the source note, or the
  script, and rebuild.
- Keep `js/quiz.js` free of DOM and storage concerns — it's pure pool/scoring logic, which
  is what makes it easy to reason about independent of a subject's content.
- No build step, no dependencies to add. If a task seems to call for a framework or a
  package, prefer doing it in vanilla JS consistent with the existing style instead.
