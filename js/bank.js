// Loads the generated question JSON. Everything is memoised for the page's
// lifetime; the service worker handles persistence across loads.

const cache = new Map();
let indexPromise = null;

async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

/** The subject/module catalogue. */
export function getIndex() {
  if (!indexPromise) {
    indexPromise = loadJSON('data/index.json').catch((err) => {
      indexPromise = null; // let a later attempt retry
      throw err;
    });
  }
  return indexPromise;
}

/**
 * One module's 100 questions. Every question is tagged with its own module
 * number as it loads — an all-modules session spans four progress keys, so the
 * module has to travel with the question rather than with the session.
 */
export function getModule(subject, module) {
  const key = `${subject}-${module}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      loadJSON(`data/${key}.json`)
        .then((data) => ({ ...data, questions: data.questions.map((q) => ({ ...q, module: data.module })) }))
        .catch((err) => {
          cache.delete(key);
          throw err;
        }),
    );
  }
  return cache.get(key);
}

/** Every question in a subject, flattened across its four modules. */
export function getSubjectQuestions(subjectId) {
  const key = `${subjectId}-*`;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const subject = await findSubject(subjectId);
        if (!subject) throw new Error(`Unknown subject ${subjectId}`);
        const loaded = await Promise.all(subject.modules.map((m) => getModule(subjectId, m.number)));
        return loaded.flatMap((data) => data.questions);
      })().catch((err) => {
        cache.delete(key);
        throw err;
      }),
    );
  }
  return cache.get(key);
}

export async function findSubject(subjectId) {
  const index = await getIndex();
  return index.subjects.find((s) => s.id === subjectId) ?? null;
}

export async function findModule(subjectId, moduleNumber) {
  const subject = await findSubject(subjectId);
  return subject?.modules.find((m) => m.number === Number(moduleNumber)) ?? null;
}
