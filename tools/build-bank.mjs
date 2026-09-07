#!/usr/bin/env node
// Converts the Obsidian question-bank markdown notes into the JSON the site loads.
// Node stdlib only. Run from anywhere: node tools/build-bank.mjs [--<subject>=<path>...]
//
// The source grammar (verified across all 800 questions):
//   # Module <n> — <name> (Q<a>–Q<b>)      <- en dash
//   ## <topic>
//   **Q<n>** <stem on one line>
//   (A) ... (B) ... (C) ... (D) ...        <- 1, 2 or 4 lines
//
// Each subject declares its own shape (module count, questions per module and
// whether modules are authored as Set A / Set B pairs) in SUBJECTS below.
//
//   > [!success]- Answer
//   >
//   > **(X).** <explanation on one line>
//
// Anything that does not match aborts the build — a half-parsed bank is worse
// than no bank, because it fails silently during revision.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = 'C:/Users/willi/My Drive/Obsidian/Notes';

const SUBJECTS = [
  {
    id: 'ec',
    name: 'Enterprise Computing',
    short: 'EC',
    source: join(VAULT, 'Enterprise Computing', '06 EC Question Bank.md'),
    // Four modules, each authored as a "Set A" (100) + "Set B" (150) pair.
    shape: { combineSets: true, modules: 4, setSizes: [100, 150] },
  },
  {
    id: 'se',
    name: 'Software Engineering',
    short: 'SE',
    source: join(VAULT, 'Software Engineering', '07 SE Question Bank.md'),
    shape: { combineSets: true, modules: 4, setSizes: [100, 150] },
  },
  {
    id: 'cc',
    name: 'Certified in Cybersecurity',
    short: 'CC',
    source: join(VAULT, 'CC', 'CC Question Bank.md'),
    // One module per ISC2 exam domain, 25 questions each, no Set A/B split.
    shape: { combineSets: false, modules: 5, perModule: 25 },
  },
];

const MODULE_RE = /^#\s+Module\s+(\d+)\s+[—-]\s+(.+?)\s+\(Q(\d+)[–-](\d+)?Q?(\d+)?\)\s*$/;
const TOPIC_RE = /^##\s+(.+?)\s*$/;
const QUESTION_RE = /^\*\*Q(\d+)\*\*\s+(.+?)\s*$/;
const ANSWER_OPEN_RE = /^>\s*\[!success\]-\s*Answer\s*$/;
const ANSWER_BODY_RE = /^>\s*\*\*\(([A-D])\)/;
const LETTERS = ['A', 'B', 'C', 'D'];

class BuildError extends Error {}

function fail(file, line, message) {
  throw new BuildError(`${file}:${line + 1}  ${message}`);
}

/** Escape first, then convert inline markdown. That ordering is what makes the
 *  literal <script> in SE Q177 safe to drop into innerHTML. */
function inline(md) {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .trim();
}

/** Options may be spread over 1, 2 or 4 lines, so scan tokens rather than lines. */
function parseOptions(block, file, lineNo) {
  const text = block.join(' ').replace(/\s+/g, ' ').trim();
  const marks = [];
  const re = /\(([A-D])\)/g;
  let m;
  while ((m = re.exec(text)) !== null) marks.push({ letter: m[1], at: m.index, end: re.lastIndex });

  const wanted = [];
  for (const letter of LETTERS) {
    const hit = marks.find((k) => k.letter === letter);
    if (!hit) fail(file, lineNo, `option (${letter}) missing from: ${text.slice(0, 80)}`);
    wanted.push(hit);
  }
  for (let i = 1; i < wanted.length; i++) {
    if (wanted[i].at < wanted[i - 1].at) fail(file, lineNo, 'options are out of A–D order');
  }

  return wanted.map((hit, i) => {
    const stop = i + 1 < wanted.length ? wanted[i + 1].at : text.length;
    const raw = text.slice(hit.end, stop).trim();
    if (!raw) fail(file, lineNo, `option (${hit.letter}) is empty`);
    return inline(raw);
  });
}

/** Drop the restated "**(C).**" / "**(C) 8**" prefix — the app renders the letter itself. */
function stripAnswerPrefix(body) {
  return body
    .replace(/^\*\*\([A-D]\)([^*]*)\*\*\s*/, (_, label) => {
      const tidy = label.replace(/^[.\s]+|[.\s]+$/g, '').trim();
      return tidy ? `**${tidy}** — ` : '';
    })
    .replace(/^\*\*([^*]+)\*\*\s*—\s*—\s*/, '**$1** — ')
    .replace(/^—\s*/, '')
    .trim();
}

function parseBank(subject) {
  const file = subject.source;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const modules = [];
  let current = null;
  let topic = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const mod = MODULE_RE.exec(line);
    if (mod) {
      current = { number: Number(mod[1]), name: mod[2], questions: [] };
      modules.push(current);
      topic = '';
      continue;
    }

    const top = TOPIC_RE.exec(line);
    if (top) {
      topic = top[1];
      continue;
    }

    const q = QUESTION_RE.exec(line);
    if (!q) continue;
    if (!current) fail(file, i, `Q${q[1]} appears before any "# Module" heading`);

    const id = Number(q[1]);
    const stem = inline(q[2]);
    if (!stem) fail(file, i, `Q${id} has an empty stem`);

    // Options: consecutive lines starting with "(", beginning on the next line.
    let j = i + 1;
    const optionLines = [];
    while (j < lines.length && lines[j].startsWith('(')) optionLines.push(lines[j++]);
    if (!optionLines.length) fail(file, i, `Q${id} has no option lines`);
    const options = parseOptions(optionLines, file, i);

    // Answer callout: skip blanks, then "> [!success]- Answer", a bare ">", then the body.
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j >= lines.length || !ANSWER_OPEN_RE.test(lines[j])) {
      fail(file, j, `Q${id} is not followed by an answer callout`);
    }
    j++;
    while (j < lines.length && lines[j].trim() === '>') j++;
    const bodyLine = lines[j] ?? '';
    const letter = ANSWER_BODY_RE.exec(bodyLine);
    if (!letter) fail(file, j, `Q${id} answer body does not start with **(A-D)`);

    const explanation = inline(stripAnswerPrefix(bodyLine.replace(/^>\s?/, '')));
    if (!explanation) fail(file, j, `Q${id} has an empty explanation`);

    current.questions.push({
      id,
      topic,
      stem,
      options,
      answer: LETTERS.indexOf(letter[1]),
      explanation,
    });

    i = j;
  }

  // Structural assertions — loud failure beats a silently short bank.
  const { combineSets, modules: wantModules, setSizes, perModule } = subject.shape;
  const wantParsed = combineSets ? wantModules * 2 : wantModules;
  if (modules.length !== wantParsed) {
    throw new BuildError(
      `${file}: expected ${wantParsed} "# Module" sections${combineSets ? ` (${wantModules} Set A/B pairs)` : ''}, found ${modules.length}`,
    );
  }

  const sizeOf = (i) => (combineSets ? setSizes[i % 2] : perModule);
  const wantTotal = modules.reduce((n, _, i) => n + sizeOf(i), 0);

  let expected = 1;
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const expectedCount = sizeOf(i);

    if (m.questions.length !== expectedCount) {
      throw new BuildError(`${file}: module ${i + 1} has ${m.questions.length} questions, expected ${expectedCount}`);
    }

    for (const q of m.questions) {
      if (q.id !== expected) {
        throw new BuildError(`${file}: expected Q${expected}, found Q${q.id} (ids must be contiguous 1–${wantTotal})`);
      }
      if (q.options.length !== 4) {
        throw new BuildError(`${file}: Q${q.id} has ${q.options.length} options`);
      }
      if (q.answer < 0 || q.answer > 3) throw new BuildError(`${file}: Q${q.id} has an invalid answer index`);
      expected++;
    }
  }
  if (expected !== wantTotal + 1) {
    throw new BuildError(`${file}: expected ${wantTotal} questions, found ${expected - 1}`);
  }

  if (!combineSets) return modules;

  // Combine each Set A / Set B pair into a single module.
  const combinedModules = [];
  for (let i = 0; i < modules.length; i += 2) {
    const setA = modules[i];
    const setB = modules[i + 1];
    combinedModules.push({
      number: i / 2 + 1,
      name: setA.name.replace(' · Set A', ''), // Remove the "· Set A" suffix
      questions: [...setA.questions, ...setB.questions],
    });
  }

  return combinedModules;
}

function main() {
  // Source overrides are keyed by subject id: --cc="path/to/CC Question Bank.md"
  for (const arg of process.argv.slice(2)) {
    const m = /^--([a-z0-9]+)=(.+)$/.exec(arg);
    if (!m) throw new BuildError(`unrecognised argument "${arg}" (expected --<subject>=<path>)`);
    const subject = SUBJECTS.find((s) => s.id === m[1]);
    if (!subject) throw new BuildError(`unknown subject "${m[1]}" (known: ${SUBJECTS.map((s) => s.id).join(', ')})`);
    subject.source = m[2];
  }

  const dataDir = join(ROOT, 'data');

  // Parse everything before writing anything, so a failure in the second
  // subject cannot leave data/ half-updated from the first.
  const parsed = SUBJECTS.map((subject) => ({ subject, modules: parseBank(subject) }));

  mkdirSync(dataDir, { recursive: true });
  const index = { version: new Date().toISOString().slice(0, 10), subjects: [] };

  for (const { subject, modules } of parsed) {
    const entry = { id: subject.id, name: subject.name, short: subject.short, modules: [] };

    for (const m of modules) {
      const file = `${subject.id}-${m.number}.json`;
      writeFileSync(
        join(dataDir, file),
        JSON.stringify({ subject: subject.id, module: m.number, name: m.name, questions: m.questions }),
        'utf8',
      );
      entry.modules.push({
        number: m.number,
        name: m.name,
        count: m.questions.length,
        file: `data/${file}`,
        topics: [...new Set(m.questions.map((q) => q.topic))],
      });
      console.log(`  ${subject.short} module ${m.number}  ${String(m.questions.length).padStart(3)} questions  ${m.name}`);
    }

    index.subjects.push(entry);
    console.log(`${subject.short} ${entry.modules.reduce((n, m) => n + m.count, 0)} ✓`);
  }

  const files = parsed.reduce((n, { modules }) => n + modules.length, 0);
  writeFileSync(join(dataDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log(`\nWrote data/index.json and ${files} module files.`);
}

try {
  main();
} catch (err) {
  if (err instanceof BuildError) {
    console.error(`\nBuild failed: ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}
