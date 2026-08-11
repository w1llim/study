// Session construction and scoring. No DOM and no storage in here — the caller
// resolves progress and passes it in, so this file never has to know whether a
// session covers one module or a whole subject.

/** Fisher–Yates, on a copy. */
export function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 100 is disabled automatically when fewer than 100 are unseen, so it only
// really shows up for the 400-question all-modules pool.
export const SIZES = [
  { value: 10, label: '10' },
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 'all', label: 'All unseen' },
  { value: 'endless', label: 'Endless' },
];

/**
 * Which questions are available for each mode, before any size limit.
 *  new     — never answered in this module
 *  missed  — most recent attempt was wrong
 *  endless — unseen first, then previously seen, so it never runs dry
 *  redo    — the whole module regardless of history
 */
export function poolFor(questions, progress, mode) {
  const seen = new Set(progress.seen);
  const wrong = new Set(progress.wrong);
  const ids = questions.map((q) => q.id);

  switch (mode) {
    case 'missed':
      return shuffle(ids.filter((id) => wrong.has(id)));
    case 'redo':
      return shuffle(ids);
    case 'endless':
      return [...shuffle(ids.filter((id) => !seen.has(id))), ...shuffle(ids.filter((id) => seen.has(id)))];
    case 'new':
    default:
      return shuffle(ids.filter((id) => !seen.has(id)));
  }
}

/**
 * Build a session. Returns null when the chosen mode has nothing to serve, so
 * the caller can explain why instead of opening an empty quiz.
 *
 * `module` is a number, or the string 'all' for a whole-subject session.
 * `progress` is resolved by the caller — one module's record, or the union of
 * a subject's four.
 */
export function buildSession(subject, module, questions, { mode = 'new', size = 25, progress } = {}) {
  const pool = poolFor(questions, progress, mode);
  if (!pool.length) return null;

  const endless = mode === 'endless';
  const limit = endless || size === 'all' ? pool.length : Math.min(Number(size), pool.length);

  return {
    subject,
    module,
    mode,
    endless,
    requested: size,
    ids: pool.slice(0, limit),
    pos: 0,
    answers: {}, // id -> chosen option index
    startedAt: Date.now(),
  };
}

export const answeredCount = (session) => Object.keys(session.answers).length;

export function scoreOf(session, byId) {
  let correct = 0;
  for (const [id, chosen] of Object.entries(session.answers)) {
    if (byId.get(Number(id))?.answer === chosen) correct++;
  }
  return { correct, total: answeredCount(session) };
}

/** Questions answered wrongly in this session, in the order they were asked. */
export function missedIn(session, byId) {
  return session.ids
    .filter((id) => id in session.answers && byId.get(id)?.answer !== session.answers[id])
    .map((id) => ({ question: byId.get(id), chosen: session.answers[id] }));
}

/** A session survives a reload only if it still has an unanswered question. */
export function isResumable(session) {
  return Boolean(session) && session.pos < session.ids.length;
}
