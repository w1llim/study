// Progress + settings persistence.
//
// Every write is wrapped: if localStorage is unavailable (private mode, quota,
// blocked cookies) the app degrades to an in-memory session rather than dying
// mid-revision. `persistent` reports which of the two you got.

const KEY_PROGRESS = 'study.progress.v1';
const KEY_SETTINGS = 'study.settings.v1';
const KEY_SESSION = 'study.session.v1';

let persistent = true;
const memory = new Map();

function readRaw(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    persistent = false;
    return memory.get(key) ?? null;
  }
}

function writeRaw(key, value) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    persistent = false;
  }
}

function removeRaw(key) {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    persistent = false;
  }
}

function readJSON(key, fallback) {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    // Corrupt value — drop it rather than wedging every later read.
    removeRaw(key);
    return fallback;
  }
}

export function isPersistent() {
  return persistent;
}

/* ---------- progress ---------- */

export const moduleKey = (subject, module) => `${subject}:${module}`;

const blank = () => ({ seen: [], correct: [], wrong: [] });

function allProgress() {
  return readJSON(KEY_PROGRESS, {});
}

/** Never returns null, and never returns the stored object by reference. */
export function getProgress(subject, module) {
  const entry = allProgress()[moduleKey(subject, module)];
  if (!entry) return blank();
  return {
    seen: Array.isArray(entry.seen) ? entry.seen.slice() : [],
    correct: Array.isArray(entry.correct) ? entry.correct.slice() : [],
    wrong: Array.isArray(entry.wrong) ? entry.wrong.slice() : [],
  };
}

/**
 * Record one answered question. Called after every answer so an app kill
 * mid-session loses nothing.
 */
export function recordAnswer(subject, module, id, wasCorrect) {
  const all = allProgress();
  const key = moduleKey(subject, module);
  const entry = { ...blank(), ...(all[key] ?? {}) };

  const seen = new Set(entry.seen);
  const correct = new Set(entry.correct);
  const wrong = new Set(entry.wrong);

  seen.add(id);
  // A question moves between the correct and wrong pools on re-answer, so
  // "practice missed" always reflects the most recent attempt.
  if (wasCorrect) {
    correct.add(id);
    wrong.delete(id);
  } else {
    wrong.add(id);
    correct.delete(id);
  }

  all[key] = {
    seen: [...seen].sort((a, b) => a - b),
    correct: [...correct].sort((a, b) => a - b),
    wrong: [...wrong].sort((a, b) => a - b),
  };
  writeRaw(KEY_PROGRESS, JSON.stringify(all));
}

export function resetModule(subject, module) {
  const all = allProgress();
  delete all[moduleKey(subject, module)];
  writeRaw(KEY_PROGRESS, JSON.stringify(all));
  clearSession();
}

export function resetSubject(subject) {
  const all = allProgress();
  for (const key of Object.keys(all)) {
    if (key.startsWith(`${subject}:`)) delete all[key];
  }
  writeRaw(KEY_PROGRESS, JSON.stringify(all));
  clearSession();
}

export function resetAll() {
  removeRaw(KEY_PROGRESS);
  removeRaw(KEY_SESSION);
}

/* ---------- settings ---------- */

export function getSettings() {
  return { theme: 'auto', lastSize: 25, ...readJSON(KEY_SETTINGS, {}) };
}

export function setSetting(name, value) {
  writeRaw(KEY_SETTINGS, JSON.stringify({ ...getSettings(), [name]: value }));
}

/* ---------- in-progress session ---------- */

export function saveSession(session) {
  writeRaw(KEY_SESSION, JSON.stringify(session));
}

export function loadSession() {
  const s = readJSON(KEY_SESSION, null);
  if (!s || !Array.isArray(s.ids) || !s.subject || !s.module) return null;
  return s;
}

export function clearSession() {
  removeRaw(KEY_SESSION);
}
