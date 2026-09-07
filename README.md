# Question Bank

Offline revision PWA for HSC **Enterprise Computing** and **Software Engineering** and ISC2
**Certified in Cybersecurity** — 2125 multiple-choice questions (EC and SE: 4 modules × 250,
combining Set A and Set B; CC: 5 modules × 25, one per exam domain), each with the explanation
from the source notes.

Live at <https://study.willim.tech>, deployed on Vercel.

Vanilla HTML, CSS and JavaScript. No framework, no bundler, no runtime dependencies.

## Using it

Open the site and pick a **module** or **All modules** (a mixed pool of every question
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
sw.js                   precaches the shell and all 2125 questions
tools/build-bank.mjs    markdown → data/*.json
tools/build-icons.mjs   generates icons/*.png
```

Routes are hash-based so the host needs no rewrites: `#/`, `#/m/<subject>/<module>` (where module
is a module number or `all`), `#/quiz`, `#/done`.

A session records progress against **the question's own module**, not the session's, which is
what lets an All-modules run write into every per-module record and stay in step with the
per-module screens.

## Regenerating the questions

The source of truth is the Obsidian notes, not `data/`:

- `Obsidian/Notes/Enterprise Computing/06 EC Question Bank.md`
- `Obsidian/Notes/Software Engineering/07 SE Question Bank.md`
- `Obsidian/Notes/CC/CC Question Bank.md`

After editing any of them:

```bash
node tools/build-bank.mjs
```

It rewrites `data/index.json` and all 13 module files, and prints a `✓` line per subject.
Each subject declares its own shape in the `SUBJECTS` array at the top of the script — how many
modules, how many questions per module, and whether the note is authored as `Set A` / `Set B`
pairs that get combined. The script asserts that shape, plus contiguous ids from 1 across the
subject, exactly four options and a valid A–D answer — **any deviation aborts the build with a
file:line**, so a malformed question is caught rather than silently dropped.

A source path can be overridden per subject: `node tools/build-bank.mjs --cc="path/to/CC Question Bank.md"`.

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
   per subject (Q1–Q1000) and **must stay contiguous**, with 250 per module — the build enforces
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

Push to `main`. Vercel (project `study`, team `we-are-vibe-coding`) builds every push and
serves <https://study.willim.tech>.

**There is no build step on Vercel.** `vercel.json` sets `buildCommand: null` and
`outputDirectory: "."`, so the repository root is served as-is. This matters: `data/*.json` is
generated by `tools/build-bank.mjs` from Obsidian notes that exist only on the author's machine,
so it is generated **locally and committed**. Never wire `build-bank.mjs` into a `build` script —
it cannot run in CI and will fail every deployment with `ENOENT` on the vault path.

**Bump `CACHE` in `sw.js`** (`study-v1` → `study-v2`, …) whenever you change any file in
`PRECACHE`. The old cache is only discarded when the name changes, so skipping this leaves
installed copies serving the previous version indefinitely.

## Troubleshooting

**The deployed site still shows the old version.** `CACHE` in `sw.js` was not bumped, so the
service worker is serving its existing copy. Bump it and redeploy. To force a local fix:
DevTools → Application → Service Workers → Unregister, then hard-reload.

**"You have seen every question in this module."** The unseen pool is empty. Use **Endless**,
**Redo whole module**, or clear that subject from the home screen.

**Offline does not work.** The app must be loaded online once so the service worker can
precache the shell and all 13 data files. Check DevTools → Application → Cache Storage for a
single `study-vN` holding 26 entries (shell + 13 modules + index).

**Progress vanished.** It is per-browser `localStorage` — a different browser, a different
device, or clearing site data all start from zero. It is deliberately not synced.

**The build fails.** It prints `file:line` and what it expected. Most often a question was
added or removed without renumbering, so a module no longer holds exactly 100.
