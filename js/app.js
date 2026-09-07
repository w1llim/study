// Router + rendering. Hash routing keeps GitHub Pages happy without rewrites.
//
// innerHTML is used *only* on the stem/options/explanation fields, which are
// escaped-then-inlined at build time by tools/build-bank.mjs. Anything that
// comes from a route or from localStorage goes through textContent.

import { getIndex, getModule, getSubjectQuestions, findSubject } from './bank.js';
import {
  getProgress, getCombinedProgress, recordAnswer, resetAll, resetSubject,
  getSettings, setSetting, saveSession, loadSession, clearSession, isPersistent,
} from './store.js';
import { SIZES, buildSession, poolFor, scoreOf, missedIn, isResumable } from './quiz.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const ALL = 'all'; // a session's module, when it spans the whole subject
const screen = document.getElementById('screen');
const announcer = document.getElementById('announcer');
const scoreBadge = document.getElementById('session-score');

/** Live state for the current session. */
let session = null;
let questions = [];
let byId = new Map();
let revealed = false;
let finished = null; // completed session parked for the results screen

/* ---------- tiny DOM helpers ---------- */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn);
    else if (key === 'dataset') for (const [k, v] of Object.entries(value)) node.dataset[k] = v;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function paint(...nodes) {
  screen.replaceChildren(...nodes);
  document.getElementById('main').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function say(message) {
  announcer.textContent = '';
  // Re-setting on the next frame is what makes screen readers re-announce.
  requestAnimationFrame(() => { announcer.textContent = message; });
}

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

/** One module's progress, or the union of a subject's four. */
function progressFor(subjectId, module, moduleNumbers) {
  return module === ALL
    ? getCombinedProgress(subjectId, moduleNumbers)
    : getProgress(subjectId, module);
}

/** The questions a session draws from. */
function questionsFor(subjectId, module) {
  return module === ALL ? getSubjectQuestions(subjectId) : getModule(subjectId, module).then((d) => d.questions);
}

const moduleLabel = (module) => (module === ALL ? 'All modules' : `Module ${module}`);

function fatal(message) {
  paint(
    el('div', { class: 'empty' }, [
      el('p', { text: message }),
      el('p', {}, [el('a', { class: 'btn', href: '#/', text: 'Back to start' })]),
    ]),
  );
}

/* ---------- theme ---------- */

const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  document.getElementById('theme-icon').textContent = THEME_ICON[theme];
  document.getElementById('theme-toggle').title = `Theme: ${theme}`;
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(getSettings().theme) + 1) % THEMES.length];
  setSetting('theme', next);
  applyTheme(next);
  say(`Theme ${next}`);
});

/* ---------- score badge ---------- */

function updateBadge() {
  if (!session) {
    scoreBadge.hidden = true;
    return;
  }
  const { correct, total } = scoreOf(session, byId);
  scoreBadge.hidden = false;
  scoreBadge.textContent = total ? `${correct}/${total}` : '—';
}

/* ---------- home ---------- */

async function renderHome() {
  session = null;
  updateBadge();

  const index = await getIndex();
  const nodes = [
    el('h1', { text: 'Question Bank' }),
    el('p', { class: 'lede', text: '2125 multiple-choice questions across Enterprise Computing, Software Engineering and Certified in Cybersecurity. Pick a module — questions are randomised and never repeat until you have seen them all.' }),
  ];

  const parked = loadSession();
  if (isResumable(parked)) {
    const subject = index.subjects.find((s) => s.id === parked.subject);
    // 'all' matches no module, so it needs its own pass or the banner vanishes.
    const known = subject && (parked.module === ALL || subject.modules.some((m) => m.number === parked.module));
    if (known) {
      nodes.push(
        el('div', { class: 'note warn', style: 'margin-bottom:1.5rem' }, [
          el('span', { text: `Unfinished session: ${subject.short} ${moduleLabel(parked.module).toLowerCase()}, question ${parked.pos + 1} of ${parked.ids.length}. ` }),
          el('span', { class: 'btn-row', style: 'margin-top:.6rem' }, [
            el('a', { class: 'btn btn-primary', href: '#/quiz', text: 'Resume' }),
            el('button', {
              class: 'btn btn-quiet', type: 'button', text: 'Discard',
              on: { click: () => { clearSession(); route(); } },
            }),
          ]),
        ]),
      );
    }
  }

  const sections = [];
  for (const subject of index.subjects) {
    const totals = subject.modules.reduce(
      (acc, m) => {
        const p = getProgress(subject.id, m.number);
        acc.seen += p.seen.length;
        acc.correct += p.correct.length;
        acc.count += m.count;
        return acc;
      },
      { seen: 0, correct: 0, count: 0 },
    );

    const cards = subject.modules.map((m) => {
      const p = getProgress(subject.id, m.number);
      const done = p.seen.length >= m.count;
      return el('a', { class: 'module-card', href: `#/m/${subject.id}/${m.number}` }, [
        el('span', { class: 'm-num', text: `Module ${m.number}` }),
        el('span', { class: 'm-name', text: m.name }),
        el('span', { class: `bar${done ? ' done' : ''}` }, [
          el('span', { style: `width:${pct(p.seen.length, m.count)}%` }),
        ]),
        el('span', { class: 'm-stats' }, [
          el('span', { text: `${p.seen.length} / ${m.count} seen` }),
          el('span', { text: p.seen.length ? `${pct(p.correct.length, p.seen.length)}% correct` : 'not started' }),
        ]),
      ]);
    });

    // Mixed pool across the whole subject — spans the grid under the modules.
    cards.push(
      el('a', { class: 'module-card all-card', href: `#/m/${subject.id}/${ALL}` }, [
        el('span', { class: 'm-num', text: 'All modules' }),
        el('span', { class: 'm-name', text: `Mixed questions from all four modules` }),
        el('span', { class: `bar${totals.seen >= totals.count ? ' done' : ''}` }, [
          el('span', { style: `width:${pct(totals.seen, totals.count)}%` }),
        ]),
        el('span', { class: 'm-stats' }, [
          el('span', { text: `${totals.seen} / ${totals.count} seen` }),
          el('span', { text: totals.seen ? `${pct(totals.correct, totals.seen)}% correct` : `${totals.count} questions` }),
        ]),
      ]),
    );

    sections.push(
      el('section', { class: 'subject', dataset: { subject: subject.id } }, [
        el('div', { class: 'subject-head' }, [
          el('h2', { text: subject.name }),
          el('span', {
            class: 'meta',
            text: totals.seen
              ? `${totals.seen}/${totals.count} seen · ${pct(totals.correct, totals.seen)}% correct`
              : `${totals.count} questions`,
          }),
        ]),
        el('div', { class: 'modules' }, cards),
      ]),
    );
  }

  nodes.push(el('div', { class: 'subjects' }, sections));
  nodes.push(renderResetPanel(index));
  paint(...nodes);
}

function renderResetPanel(index) {
  const foot = el('footer', { class: 'home-foot' }, [el('h2', { text: 'Progress' })]);

  const buttons = el('div', { class: 'btn-row' }, [
    ...index.subjects.map((s) =>
      el('button', {
        class: 'btn', type: 'button', text: `Clear ${s.short}`,
        on: { click: () => confirmReset(`Clear all ${s.name} progress?`, () => resetSubject(s.id)) },
      }),
    ),
    el('button', {
      class: 'btn btn-danger', type: 'button', text: 'Clear everything',
      on: { click: () => confirmReset('Clear stored progress for all subjects? Every question becomes unseen again.', resetAll) },
    }),
  ]);

  const panel = el('div', { class: 'reset-panel' }, [
    el('p', {
      style: 'margin:0',
      text: isPersistent()
        ? 'Answers are stored in this browser only, so already-seen questions are skipped. Clearing makes every question available again.'
        : 'This browser is blocking local storage, so progress will not survive a reload.',
    }),
    buttons,
  ]);

  function confirmReset(message, action) {
    panel.replaceChildren(
      el('div', { class: 'reset-confirm' }, [
        el('p', { text: message }),
        el('div', { class: 'btn-row' }, [
          el('button', {
            class: 'btn btn-danger', type: 'button', text: 'Yes, clear it',
            on: { click: () => { action(); say('Progress cleared'); route(); } },
          }),
          el('button', {
            class: 'btn btn-quiet', type: 'button', text: 'Cancel',
            on: { click: () => route() },
          }),
        ]),
      ]),
    );
  }

  foot.append(panel);
  return foot;
}

/* ---------- module start panel ---------- */

async function renderStart(subjectId, moduleParam) {
  session = null;
  updateBadge();

  const subject = await findSubject(subjectId);
  if (!subject) return fatal('That subject does not exist.');

  const isAll = moduleParam === ALL;
  const numbers = subject.modules.map((m) => m.number);
  // A synthetic module record keeps the rest of this function uniform.
  const meta = isAll
    ? {
        number: ALL,
        name: 'All modules',
        count: subject.modules.reduce((n, m) => n + m.count, 0),
        topics: [],
      }
    : subject.modules.find((m) => m.number === Number(moduleParam));
  if (!meta) return fatal('That module does not exist.');

  const list = await questionsFor(subject.id, meta.number);
  const progress = progressFor(subject.id, meta.number, numbers);
  const unseen = poolFor(list, progress, 'new').length;
  const missed = progress.wrong.length;

  let size = getSettings().lastSize;
  if (!SIZES.some((s) => s.value === size)) size = 25;
  // Don't leave a disabled button looking selected when the pool has run low.
  if (unseen > 0 && typeof size === 'number' && size > unseen) size = 'all';

  const sizeButtons = SIZES.map((option) => {
    const tooBig = typeof option.value === 'number' && option.value > unseen;
    return el('button', {
      class: 'size', type: 'button', text: option.label,
      'aria-pressed': String(option.value === size),
      disabled: tooBig && unseen > 0,
      title: tooBig && unseen > 0 ? `Only ${unseen} unseen questions left` : undefined,
      on: {
        click: (event) => {
          size = option.value;
          setSetting('lastSize', option.value);
          for (const sib of event.currentTarget.parentElement.children) {
            sib.setAttribute('aria-pressed', String(sib === event.currentTarget));
          }
        },
      },
    });
  });

  const begin = (mode, chosen = size) =>
    start(subject.id, meta.number, list, { mode, size: chosen, progress: progressFor(subject.id, meta.number, numbers) });

  const actions = el('div', { class: 'btn-row' }, [
    el('button', {
      class: 'btn btn-primary', type: 'button',
      text: unseen ? 'Start' : 'Start (endless)',
      on: { click: () => begin(unseen ? (size === 'endless' ? 'endless' : 'new') : 'endless') },
    }),
    missed > 0 &&
      el('button', {
        class: 'btn', type: 'button', text: `Practise missed (${missed})`,
        on: { click: () => begin('missed', 'all') },
      }),
    progress.seen.length > 0 &&
      el('button', {
        class: 'btn', type: 'button', text: isAll ? 'Redo whole subject' : 'Redo whole module',
        on: { click: () => begin('redo') },
      }),
  ].filter(Boolean));

  paint(
    el('p', {}, [el('a', { class: 'btn btn-quiet', href: '#/', text: '← All modules' })]),
    el('div', { class: 'start-card', dataset: { subject: subject.id } }, [
      el('p', { class: 'eyebrow', text: isAll ? subject.name : `${subject.name} · Module ${meta.number}` }),
      el('h1', { text: meta.name }),
      el('div', { class: 'stat-row' }, [
        el('span', { class: 'stat' }, [el('b', { text: String(unseen) }), el('span', { text: 'unseen' })]),
        el('span', { class: 'stat' }, [el('b', { text: `${progress.seen.length}/${meta.count}` }), el('span', { text: 'attempted' })]),
        el('span', { class: 'stat' }, [
          el('b', { text: progress.seen.length ? `${pct(progress.correct.length, progress.seen.length)}%` : '—' }),
          el('span', { text: 'correct' }),
        ]),
        el('span', { class: 'stat' }, [el('b', { text: String(missed) }), el('span', { text: 'to revisit' })]),
      ]),
      unseen === 0
        ? el('p', {
            class: 'note warn',
            text: `You have seen every question in ${isAll ? 'this subject' : 'this module'}. Endless keeps going over old ones, or clear ${isAll ? 'the subject' : 'the module'} from the home screen.`,
          })
        : el('fieldset', {}, [
            el('legend', { text: 'How many questions?' }),
            el('div', { class: 'sizes' }, sizeButtons),
          ]),
      actions,
      isAll
        ? el('details', { class: 'topic-list' }, [
            el('summary', { text: `Drawing from all ${subject.modules.length} modules` }),
            el('ul', {}, subject.modules.map((m) => {
              const p = getProgress(subject.id, m.number);
              return el('li', { text: `Module ${m.number} — ${m.name} (${p.seen.length}/${m.count} seen)` });
            })),
          ])
        : el('details', { class: 'topic-list' }, [
            el('summary', { text: `${meta.topics.length} topics in this module` }),
            el('ul', {}, meta.topics.map((t) => el('li', { text: t }))),
          ]),
    ]),
  );
}

function start(subjectId, moduleNumber, list, options) {
  const built = buildSession(subjectId, moduleNumber, list, options);
  if (!built) {
    say('Nothing to ask');
    return;
  }
  questions = list;
  byId = new Map(list.map((q) => [q.id, q]));
  session = built;
  finished = null;
  saveSession(session);
  // Assigning an unchanged hash fires no hashchange, so render directly.
  if (location.hash === '#/quiz') renderQuiz();
  else location.hash = '#/quiz';
}

/* ---------- quiz ---------- */

async function ensureSession() {
  if (session && byId.size) return true;
  const parked = loadSession();
  if (!isResumable(parked)) return false;
  questions = await questionsFor(parked.subject, parked.module);
  byId = new Map(questions.map((q) => [q.id, q]));
  session = parked;
  return true;
}

async function renderQuiz() {
  if (!(await ensureSession())) {
    location.hash = '#/';
    return;
  }
  if (session.pos >= session.ids.length) return finish();

  revealed = false;
  const question = byId.get(session.ids[session.pos]);
  if (!question) { // data changed under a stored session
    clearSession();
    return fatal('That saved session no longer matches the question bank. Start a new one.');
  }

  const total = session.ids.length;
  const subjectShort = session.subject.toUpperCase();
  updateBadge();

  const optionNodes = question.options.map((option, i) =>
    el('button', {
      class: 'option', type: 'button', dataset: { index: String(i) },
      on: { click: () => choose(i) },
    }, [
      el('span', { class: 'letter', text: LETTERS[i] }),
      el('span', { html: option }),
      el('span', { class: 'mark', 'aria-hidden': 'true' }),
    ]),
  );

  const wrap = el('div', { class: 'quiz', dataset: { subject: session.subject } }, [
    el('div', { class: 'quiz-head' }, [
      el('span', { class: 'crumb' }, [
        el('b', { text: subjectShort }),
        ` · ${moduleLabel(session.module)}`,
      ]),
      el('span', {
        class: 'crumb',
        text: session.endless ? `Question ${session.pos + 1}` : `${session.pos + 1} of ${total}`,
      }),
    ]),
    session.endless
      ? null
      : el('div', { class: 'progress-track' }, [el('span', { style: `width:${pct(session.pos, total)}%` })]),
    el('span', {
      class: 'chip',
      // In a mixed session the topic alone doesn't say where a question came from.
      text: session.module === ALL ? `Module ${question.module} · ${question.topic}` : question.topic,
    }),
    el('p', { class: 'stem', html: question.stem }),
    el('div', { class: 'options', id: 'options' }, optionNodes),
    el('div', { id: 'verdict' }),
    el('div', { class: 'quiz-foot' }, [
      el('button', {
        class: 'btn btn-quiet', type: 'button',
        text: session.endless ? 'Finish' : 'Quit session',
        on: { click: () => finish() },
      }),
      el('span', { class: 'keyhint' }, [
        el('kbd', { text: '1' }), '–', el('kbd', { text: '4' }), ' answer · ',
        el('kbd', { text: 'Enter' }), ' next',
      ]),
    ]),
  ]);

  paint(wrap);
}

function choose(index) {
  if (revealed) return;
  revealed = true;

  const question = byId.get(session.ids[session.pos]);
  const isCorrect = index === question.answer;

  session.answers[question.id] = index;
  // Always the question's own module, so a mixed session writes to the right
  // four keys and shares progress with the per-module screens.
  recordAnswer(session.subject, question.module, question.id, isCorrect);

  const buttons = [...document.getElementById('options').children];
  buttons.forEach((button, i) => {
    button.disabled = true;
    if (i === question.answer) {
      button.classList.add('correct');
      button.querySelector('.mark').textContent = '✓';
    } else if (i === index) {
      button.classList.add('wrong');
      button.querySelector('.mark').textContent = '✗';
    } else {
      button.classList.add('muted');
    }
  });

  const next = el('button', {
    class: 'btn btn-primary', type: 'button', id: 'next',
    text: session.pos + 1 >= session.ids.length && !session.endless ? 'See results' : 'Next question',
    on: { click: advance },
  });

  document.getElementById('verdict').replaceChildren(
    el('div', { class: `verdict ${isCorrect ? 'is-correct' : 'is-wrong'}` }, [
      el('p', { class: 'verdict-head' }, [
        isCorrect ? '✓ Correct' : `✗ Not quite — the answer is ${LETTERS[question.answer]}`,
      ]),
      el('p', { html: question.explanation }),
    ]),
    el('div', { class: 'btn-row' }, [next]),
  );

  updateBadge();
  saveSession(session);
  say(isCorrect ? 'Correct' : `Incorrect. The answer is ${LETTERS[question.answer]}.`);
  next.focus({ preventScroll: true });
}

/** The modules the loaded question list actually covers — one, or all four. */
const loadedModules = () => [...new Set(questions.map((q) => q.module))];

function advance() {
  session.pos++;
  // Endless mode keeps going by reshuffling everything it has already used.
  if (session.endless && session.pos >= session.ids.length) {
    session.ids = session.ids.concat(
      poolFor(questions, progressFor(session.subject, session.module, loadedModules()), 'endless'),
    );
  }
  if (session.pos >= session.ids.length) return finish();
  saveSession(session);
  renderQuiz();
}

function finish() {
  finished = session;
  clearSession();
  if (location.hash === '#/done') renderResults();
  else location.hash = '#/done';
}

/* ---------- results ---------- */

function renderResults() {
  if (!finished) {
    location.hash = '#/';
    return;
  }
  const done = finished;
  session = null;
  updateBadge();

  const { correct, total } = scoreOf(done, byId);
  const missed = missedIn(done, byId);
  const modules = loadedModules();
  const progress = progressFor(done.subject, done.module, modules);

  if (!total) {
    paint(
      el('div', { class: 'empty' }, [
        el('p', { text: 'That session ended before you answered anything.' }),
        el('p', {}, [el('a', { class: 'btn btn-primary', href: `#/m/${done.subject}/${done.module}`, text: 'Try again' })]),
      ]),
    );
    return;
  }

  const reviewNodes = missed.map(({ question, chosen }) =>
    el('article', { class: 'review-item' }, [
      el('span', {
        class: 'chip',
        text: done.module === ALL ? `Module ${question.module} · ${question.topic}` : question.topic,
      }),
      el('p', { class: 'r-stem', html: question.stem }),
      el('p', { class: 'r-line r-yours' }, [
        el('span', { class: 'tag', text: 'You said' }),
        el('span', { html: `${LETTERS[chosen]} — ${question.options[chosen]}` }),
      ]),
      el('p', { class: 'r-line r-right' }, [
        el('span', { class: 'tag', text: 'Answer' }),
        el('span', { html: `${LETTERS[question.answer]} — ${question.options[question.answer]}` }),
      ]),
      el('p', { class: 'r-why', html: question.explanation }),
    ]),
  );

  const replay = (mode, size) =>
    start(done.subject, done.module, questions, {
      mode, size,
      progress: progressFor(done.subject, done.module, modules),
    });
  const again = () => replay(done.mode === 'missed' ? 'missed' : 'new', done.requested);

  paint(
    el('div', { class: 'score-hero', dataset: { subject: done.subject } }, [
      el('div', { class: 'pct', text: `${pct(correct, total)}%` }),
      el('p', { class: 'frac', text: `${correct} of ${total} correct · ${done.subject.toUpperCase()} ${moduleLabel(done.module).toLowerCase()}` }),
    ]),
    missed.length
      ? el('h2', { text: `Review — ${missed.length} to go back over` })
      : el('p', { class: 'empty', text: 'Clean sweep. Nothing to review.' }),
    el('div', { class: 'review' }, reviewNodes),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-primary', type: 'button', text: 'Another batch', on: { click: again } }),
      progress.wrong.length > 0 &&
        el('button', {
          class: 'btn', type: 'button', text: `Practise missed (${progress.wrong.length})`,
          on: { click: () => replay('missed', 'all') },
        }),
      el('a', { class: 'btn btn-quiet', href: '#/', text: 'All modules' }),
    ].filter(Boolean)),
  );
}

/* ---------- keyboard ---------- */

document.addEventListener('keydown', (event) => {
  if (!session || event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (!revealed) {
    const key = event.key.toLowerCase();
    const index = '1234'.includes(key) ? Number(key) - 1 : 'abcd'.indexOf(key);
    if (index >= 0 && index < 4) {
      event.preventDefault();
      choose(index);
    }
    return;
  }
  if (event.key === 'Enter' || event.key === 'ArrowRight' || event.key === ' ') {
    // A focused button already activates on Enter/Space — don't advance twice.
    if (event.key !== 'ArrowRight' && document.activeElement?.tagName === 'BUTTON') return;
    event.preventDefault();
    advance();
  }
});

/* ---------- routing ---------- */

async function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'm' && parts[1] && parts[2]) await renderStart(parts[1], parts[2]);
    else if (parts[0] === 'quiz') await renderQuiz();
    else if (parts[0] === 'done') renderResults();
    else await renderHome();
  } catch (err) {
    console.error(err);
    fatal('Could not load the question bank. If this is the first visit, reconnect once so it can be cached for offline use.');
  }
}

window.addEventListener('hashchange', route);

applyTheme(getSettings().theme);
route();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed:', err));
  });
}
