# Question Bank

Offline revision PWA for HSC **Enterprise Computing** and **Software Engineering** — 2000
multiple-choice questions (8 modules × 250 per subject, combining Set A and Set B), each with the explanation from the
source notes.

Live at <https://w1llim.github.io/study/>.

Vanilla HTML, CSS and JavaScript. No framework, no bundler, no runtime dependencies.

## Using it

Open the site and pick a **module** (100–150 questions) or **All modules** (a mixed pool of all 1000
for that subject — closer to what an actual exam throws at you). Choose how many questions:

| Size | What it does |
|---|---|
| 10 / 25 / 50 / 100 | A fixed batch, then a results screen. Disabled if fewer are unseen. |
| All unseen | Everything you have not answered yet. |
| Endless | Keeps going until you press Finish; recycles old questions once the unseen run out. |

Then answer. Tap an option or press `1`–`4` (or `a`–`d`); the correct answer highlights
immediately with the explanation from the source note, and `Enter` moves on. Your running score
sits in the top bar.

At the end you get a percentage and every question you missed, with what you picked, the right
answer and why. **Practise missed** rebuilds a session from only those questions.

Other things worth knowing:

- **Questions never repeat** until the pool is exhausted — order is reshuffled each session.
- **Option order is never shuffled** (see below for why).
- **Progress is shared** between the per-module and All-modules screens. Answering a Module 2
  question inside a mixed run marks it seen on the Module 2 card too.
- The theme button in the top bar cycles auto → light → dark.
- It is installable and works fully offline after one online load.

## Where progress lives

Three `localStorage` keys, in that browser only — nothing is synced, and a different browser or
device starts fresh:

| Key | Holds |
|---|---|
| `study.progress.v1` | Per module (`ec:1` … `se:4`): which ids are `seen`, `correct`, `wrong`. |
| `study.settings.v1` | Theme and last-used batch size. |
| `study.session.v1` | The in-progress session, so a reload or app kill resumes where you left off. |

`wrong` always reflects your **most recent** attempt, so getting a question right removes it
from the practise-missed pool.

The home screen's **Clear EC** / **Clear SE** / **Clear everything** buttons wipe
`study.progress.v1` (and any parked session) and make every question unseen again. There is a
confirmation step; there is no undo.

## Layout

```
index.html              app shell
css/styles.css          one stylesheet, light + dark
js/app.js               hash router + rendering
js/bank.js              loads data/*.json, tags each question with its module
js/quiz.js              pool selection, shuffling, scoring (no DOM, no storage)
js/store.js             localStorage progress + settings
data/*.json             generated — do not hand-edit
sw.js                   precaches the shell and all 2000 questions
tools/build-bank.mjs    markdown → data/*.json
tools/build-icons.mjs   generates icons/*.png
```

Routes are hash-based so Pages needs no rewrites: `#/`, `#/m/<subject>/<module>` (where module
is `1`–`4` or `all`), `#/quiz`, `#/done`.

A session records progress against **the question's own module**, not the session's, which is
what lets an All-modules run write into all four per-module records and stay in step with the
per-module screens.

## Regenerating the questions

The source of truth is the two Obsidian notes, not `data/`:

- `Obsidian/Notes/Enterprise Computing/06 EC Question Bank.md`
- `Obsidian/Notes/Software Engineering/07 SE Question Bank.md`

After editing either note:

```bash
node tools/build-bank.mjs
```

It rewrites `data/index.json` and the 16 module files, and prints `EC 1000 ✓ / SE 1000 ✓`.
The script asserts 8 modules (4 pairs of Set A and Set B), 1000 questions per subject, contiguous ids 1–1000, exactly four options
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

### Adding or editing a question

1. Edit the Obsidian note, following the grammar above exactly. Questions are numbered globally
   per subject (Q1–Q1000) and **must stay contiguous**, with 250 per module (100 Set A + 150 Set B) — the build enforces
   both, so adding a question means renumbering the ones after it.
2. `node tools/build-bank.mjs`
3. Bump `CACHE` in `sw.js` before deploying, or installed copies keep the old questions.

Never edit `data/*.json` directly; the next build overwrites it.

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

## Troubleshooting

**The deployed site still shows the old version.** `CACHE` in `sw.js` was not bumped, so the
service worker is serving its existing copy. Bump it and redeploy. To force a local fix:
DevTools → Application → Service Workers → Unregister, then hard-reload.

**"You have seen every question in this module."** The unseen pool is empty. Use **Endless**,
**Redo whole module**, or clear that subject from the home screen.

**Offline does not work.** The app must be loaded online once so the service worker can
precache the shell and all 16 data files. Check DevTools → Application → Cache Storage for a
single `study-vN` holding 29 entries (shell + 16 modules + index).

**Progress vanished.** It is per-browser `localStorage` — a different browser, a different
device, or clearing site data all start from zero. It is deliberately not synced.

**The build fails.** It prints `file:line` and what it expected. Most often a question was
added or removed without renumbering, so a module no longer holds exactly 100.
