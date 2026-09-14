/* Install, update and connectivity — everything about being an app rather than
 * a page. Deliberately independent of the router: it touches only the three
 * chrome elements it owns (#install-btn, #net-status, #toast-host) and never
 * the quiz, so app.js stays about questions.
 *
 * The three jobs:
 *   1. Register the service worker and mediate its update handshake, so a new
 *      deploy is offered rather than swapped in mid-session.
 *   2. Own the install affordance — the deferred `beforeinstallprompt` on
 *      Chromium, and a short how-to on iOS, which has no such event.
 *   3. Say when the app is offline, which for an offline-first app is
 *      reassurance rather than an error.
 */

const installBtn = document.getElementById('install-btn');
const netStatus = document.getElementById('net-status');
const toastHost = document.getElementById('toast-host');

/* ---------- toasts ---------- */

/**
 * A single live toast — a second one replaces the first, because two stacked
 * banners over a question is worse than losing the older message.
 * `action` is an optional { label, onClick }.
 */
function toast(message, { action = null, timeout = 0 } = {}) {
  if (!toastHost) return () => {};

  const node = document.createElement('div');
  node.className = 'toast';
  node.setAttribute('role', 'status');

  const text = document.createElement('p');
  text.className = 'toast-text';
  text.textContent = message;
  node.append(text);

  const dismiss = () => node.remove();

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-primary toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => { dismiss(); action.onClick(); });
    node.append(button);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', dismiss);
  node.append(close);

  toastHost.replaceChildren(node);
  if (timeout) setTimeout(() => { if (node.isConnected) dismiss(); }, timeout);
  return dismiss;
}

/* ---------- service worker + updates ---------- */

// Only a user-accepted update reloads the page. A first-visit worker also fires
// controllerchange when it calls clients.claim(), and reloading on that would
// bounce every new visitor.
let reloading = false;

function offerUpdate(worker) {
  toast('A new version of the question bank is ready.', {
    action: {
      label: 'Update',
      onClick: () => {
        reloading = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
        // If the worker never takes over (it was already discarded), reload
        // anyway rather than leaving the button looking dead.
        setTimeout(() => { if (reloading) location.reload(); }, 3000);
      },
    },
  });
}

/** An installing worker becomes an offer only once it is installed *and* an
 *  older worker is already in control — otherwise it is the first install. */
function watch(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
  });
}

async function registerWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading) return;
    reloading = false;
    location.reload();
  });

  let registration;
  try {
    // updateViaCache: 'none' keeps the HTTP cache from serving a stale sw.js,
    // which would hide every deploy until the browser's own 24h refresh.
    registration = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
  } catch (err) {
    console.warn('Service worker failed:', err);
    return;
  }

  if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));

  // Look for a new deploy when the app is reopened, but not more than hourly —
  // the point is to catch the app being left installed for weeks, not to poll.
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheck < 60 * 60 * 1000) return;
    lastCheck = Date.now();
    registration.update().catch(() => {});
  });
}

/* ---------- storage durability ---------- */

/**
 * Ask the browser not to evict us under storage pressure. Without this both the
 * precached banks and the saved progress are best-effort, and a browser tidying
 * up space can silently wipe a term's worth of revision. Chromium grants it on
 * an installed PWA; elsewhere it is a no-op we do not report.
 */
async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch { /* not supported, or denied — nothing to do either way */ }
}

/* ---------- install ---------- */

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.matchMedia('(display-mode: minimal-ui)').matches ||
  window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function setupInstall() {
  if (!installBtn) return;

  let deferred = null;

  const show = (handler) => {
    installBtn.hidden = false;
    installBtn.addEventListener('click', handler);
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    // Chromium: suppress the mini-infobar and drive the prompt from our button.
    event.preventDefault();
    deferred = event;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferred) return;
    const prompt = deferred;
    deferred = null;
    installBtn.hidden = true;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // A dismissal is not a refusal forever — put the button back.
    if (outcome !== 'accepted') installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    installBtn.hidden = true;
    toast('Installed. It works offline from here on.', { timeout: 6000 });
  });

  // iOS never fires beforeinstallprompt, so the button explains the manual route.
  if (isIOS() && !isStandalone()) {
    show(() => toast('In Safari: tap Share, then "Add to Home Screen".', { timeout: 9000 }));
  }
}

/* ---------- connectivity ---------- */

function setupNetworkStatus() {
  if (!netStatus) return;
  const paint = () => {
    const offline = !navigator.onLine;
    netStatus.hidden = !offline;
    netStatus.textContent = offline ? 'Offline' : '';
  };
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  paint();
}

setupInstall();
setupNetworkStatus();
registerWorker();
requestPersistence();
