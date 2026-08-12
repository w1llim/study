#!/usr/bin/env node
// Converts the Obsidian question-bank markdown notes into the JSON the site loads.
// Node stdlib only. Run from anywhere: node tools/build-bank.mjs [ecPath] [sePath]
//
// The source grammar (verified across all 800 questions):
//   # Module <n> — <name> (Q<a>–Q<b>)      <- en dash
//   ## <topic>
//   **Q<n>** <stem on one line>
//   (A) ... (B) ... (C) ... (D) ...        <- 1, 2 or 4 lines
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
  },
  {
    id: 'se',
    name: 'Software Engineering',
    short: 'SE',
    source: join(VAULT, 'Software Engineering', '07 SE Question Bank.md'),
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
  // Now expecting 8 modules (4 pairs of Set A and Set B)
  if (modules.length !== 8) {
    throw new BuildError(`${file}: expected 8 modules (4 pairs of Set A/B), found ${modules.length}`);
  }

  // Verify the structure: pairs of (Set A: 100 questions, Set B: 150 questions)
  let expected = 1;
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const isSetB = i % 2 === 1;
    const expectedCount = isSetB ? 150 : 100;

    if (m.questions.length !== expectedCount) {
      throw new BuildError(`${file}: module ${i + 1} has ${m.questions.length} questions, expected ${expectedCount}`);
    }

    for (const q of m.questions) {
      if (q.id !== expected) {
        throw new BuildError(`${file}: expected Q${expected}, found Q${q.id} (ids must be contiguous 1–1000)`);
      }
      if (q.options.length !== 4) {
        throw new BuildError(`${file}: Q${q.id} has ${q.options.length} options`);
      }
      if (q.answer < 0 || q.answer > 3) throw new BuildError(`${file}: Q${q.id} has an invalid answer index`);
      expected++;
    }
  }
  if (expected !== 1001) throw new BuildError(`${file}: expected 1000 questions, found ${expected - 1}`);

  // Renumber modules 1-8 (they come from markdown as 1, 1 Set B, 2, 2 Set B, etc.)
  const renumberedModules = [];
  for (let i = 0; i < modules.length; i++) {
    renumberedModules.push({
      number: i + 1,
      name: modules[i].name,
      questions: modules[i].questions,
    });
  }

  return renumberedModules;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0]) SUBJECTS[0].source = argv[0];
  if (argv[1]) SUBJECTS[1].source = argv[1];

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
    console.log(`${subject.short} 1000 ✓`);
  }

  writeFileSync(join(dataDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log('\nWrote data/index.json and 20 module files.');
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
