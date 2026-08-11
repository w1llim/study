# Question Bank

Offline revision PWA for HSC **Enterprise Computing** and **Software Engineering** — 800
multiple-choice questions (4 modules × 100 per subject), each with the explanation from the
source notes.

Live at <https://w1llim.github.io/study/>.

- Pick a subject and module, choose a batch size, answer.
- Questions are shuffled and **never repeat** until the module's pool is exhausted — what you
  have already answered is kept in `localStorage`.
- Instant feedback with the worked explanation, then a review of everything you missed.
- **Practise missed** replays only the questions whose most recent attempt was wrong.
- Installable, and fully usable with no network once it has loaded once.

Vanilla HTML, CSS and JavaScript. No framework, no bundler, no runtime dependencies.

## Layout

```
index.html              app shell
css/styles.css          one stylesheet, light + dark
js/app.js               hash router + rendering
js/bank.js              loads data/*.json
js/quiz.js              pool selection, shuffling, scoring
js/store.js             localStorage progress + settings
data/*.json             generated — do not hand-edit
sw.js                   precaches the shell and all 800 questions
tools/build-bank.mjs    markdown → data/*.json
tools/build-icons.mjs   generates icons/*.png
```

## Regenerating the questions

The source of truth is the two Obsidian notes, not `data/`:

- `Obsidian/Notes/Enterprise Computing/06 EC Question Bank.md`
- `Obsidian/Notes/Software Engineering/07 SE Question Bank.md`

After editing either note:

```bash
node tools/build-bank.mjs
```

It rewrites `data/index.json` and the eight module files, and prints `EC 400 ✓ / SE 400 ✓`.
The script asserts 4 modules, 100 questions each, contiguous ids 1–400, exactly four options
and a valid A–D answer — **any deviation aborts the build with a file:line**, so a malformed
question is caught rather than silently dropped.

Paths can be overridden: `node tools/build-bank.mjs <ec.md> <se.md>`.

Icons only need regenerating if you change the mark: `node tools/build-icons.mjs`.

### What the parser expects

```markdown
**Q7** The stem, always on one line.
(A) first   (B) second
(C) third   (D) fourth

> [!success]- Answer
>
> **(C).** The explanation, always on one line.
```

Options may be spread over one, two or four lines. Inline `**bold**`, `*italic*` and
`` `code` `` survive; everything is HTML-escaped before that conversion, which is why
explanations containing a literal `<script>` are safe to render.

**Option order is deliberately preserved, never shuffled** — some explanations refer to the
distractors by letter ("(A) is abstraction, (C) is pattern recognition"), so reordering them
would make those explanations wrong. Only question order is randomised.

## Running locally

Needs a real HTTP server — ES modules and service workers do not work over `file://`.

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>.

## Deploying

Push to `main`; GitHub Pages serves the repository root.

**Bump `CACHE` in `sw.js`** (`study-v1` → `study-v2`, …) whenever you change any file in
`PRECACHE`. The old cache is only discarded when the name changes, so skipping this leaves
installed copies serving the previous version indefinitely.

`.nojekyll` is present so Pages serves the files as-is.
