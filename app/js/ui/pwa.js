// @ts-check
/**
 * Progressive Web App glue: service worker registration and the update
 * toast, the install prompt, platform checks and storage status.
 */
import { toast } from './components.js';
import { flushAll } from './autosave.js';

/** @type {any} the deferred beforeinstallprompt event (Chromium only) */
let installEvent = null;
/** @type {Set<() => void>} */
const installListeners = new Set();
/** @type {ServiceWorkerRegistration | null} */
let registration = null;
/** @type {{close: () => void, el: HTMLElement | null} | null} the "Update available" toast */
let updateToast = null;
let reloadRequested = false;

const notifyInstall = () => installListeners.forEach((f) => f());

/**
 * The Windows and macOS desktop apps define window.LNF_DESKTOP before the
 * page loads.
 * @returns {{platform: string, version: string} | null}
 */
export function desktopWrapper() {
  const d = /** @type {any} */ (window).LNF_DESKTOP;
  return d && typeof d === 'object' ? { platform: String(d.platform || ''), version: String(d.version || '') } : null;
}

/**
 * Register the service worker and listen for install and update events.
 * The desktop apps load their bundled files directly and update through
 * their installers, so they skip the service worker.
 */
export function initPwa() {
  if (desktopWrapper()) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    notifyInstall();
  });
  registerServiceWorker();
}

/** @returns {boolean} true when the browser offered an install prompt */
export function canInstall() {
  return !!installEvent;
}

/**
 * @param {() => void} fn called when install availability changes
 * @returns {() => void} unsubscribe
 */
export function onInstallChange(fn) {
  installListeners.add(fn);
  return () => { installListeners.delete(fn); };
}

/** @returns {Promise<boolean>} true when the person accepted */
export async function promptInstall() {
  if (!installEvent) return false;
  const ev = installEvent;
  installEvent = null;
  ev.prompt();
  const choice = await ev.userChoice;
  notifyInstall();
  return choice && choice.outcome === 'accepted';
}

/** @returns {boolean} running as an installed app */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
}

/** @returns {boolean} iPhone or iPad (iPadOS reports itself as a Mac with touch) */
export function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (err) {
    console.warn('Service worker registration failed; offline mode is unavailable.', err);
    return;
  }
  const reg = registration;
  // The browser checks for a new version while the page loads, often before
  // this runs, so the new worker may already be waiting or still installing.
  if (reg.waiting && navigator.serviceWorker.controller) showUpdate();
  if (reg.installing) watchInstall(reg.installing);
  reg.addEventListener('updatefound', () => { if (reg.installing) watchInstall(reg.installing); });
  // Reload only when the person tapped Reload, never in the middle of entry.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    reg.update().catch(() => {});
    // Phones resume the app instead of reloading it: offer a waiting update again.
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate();
  });
}

/**
 * Offer the update once this worker has installed.
 * @param {ServiceWorker} worker an installing worker
 */
function watchInstall(worker) {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
  });
}

/**
 * Show "Update available — Reload" unless it is already on screen (other
 * toasts can push it away; it then comes back). Reload activates whichever
 * version is waiting by then.
 */
function showUpdate() {
  if (updateToast && updateToast.el && updateToast.el.isConnected) return;
  updateToast = toast('Update available', {
    timeout: 0,
    action: { label: 'Reload', fn: () => { applyUpdate(); } },
  });
}

/**
 * Save any open form, then activate the waiting worker; the page reloads
 * when it takes control.
 * @param {ServiceWorker | null | undefined} [worker]
 */
export async function applyUpdate(worker = registration?.waiting) {
  if (!worker) return;
  reloadRequested = true;
  try { await flushAll(); } catch { /* the draft stays dirty; reload anyway */ }
  worker.postMessage({ type: 'SKIP_WAITING' });
}

/** @returns {boolean} an update is installed and waiting */
export function updateWaiting() {
  return !!registration?.waiting;
}

/**
 * Ask the server for a newer version now.
 * @returns {Promise<'unsupported' | 'available' | 'downloading' | 'current' | 'offline'>}
 */
export async function checkForUpdate() {
  if (!registration) return 'unsupported';
  try {
    await registration.update();
  } catch {
    return 'offline';
  }
  if (registration.waiting) {
    showUpdate();
    return 'available';
  }
  return registration.installing ? 'downloading' : 'current';
}

/** @returns {Promise<boolean | null>} null when unsupported */
export async function requestPersist() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  try { return await navigator.storage.persist(); } catch { return null; }
}

/** @returns {Promise<{persisted: boolean | null, usage: number | null, quota: number | null}>} */
export async function storageStatus() {
  const s = navigator.storage;
  let persisted = null;
  let usage = null;
  let quota = null;
  try { if (s && s.persisted) persisted = await s.persisted(); } catch { /* unsupported */ }
  try {
    if (s && s.estimate) {
      const e = await s.estimate();
      usage = e.usage ?? null;
      quota = e.quota ?? null;
    }
  } catch { /* unsupported */ }
  return { persisted, usage, quota };
}
