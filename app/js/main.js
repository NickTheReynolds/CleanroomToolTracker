// @ts-check
/**
 * Boot: open and seed the database, apply the theme, run the hash router,
 * then register the service worker and ask for persistent storage.
 */
import { setDbNotifier } from './data/db.js';
import { ensureSeeded, getSettings, saveSettings, getDraft, LOG_DRAFT, logTimerRunning } from './data/repo.js';
import { matchRoute, parseHash, consumeReplace, track, canGoBack } from './router.js';
import { h, clear } from './ui/dom.js';
import { toast, button, linkButton, errorText } from './ui/components.js';
import { initShell, setTitle, setBack, setActions, setNavActive } from './ui/shell.js';
import { applyTheme } from './ui/theme.js';
import { initPwa, requestPersist, desktopWrapper } from './ui/pwa.js';

const main = /** @type {HTMLElement} */ (document.getElementById('view'));
let token = 0;
/** @type {(() => void | Promise<void>) | null} */
let cleanup = null;

/**
 * @param {string} message
 * @param {unknown} [err]
 * @returns {HTMLElement}
 */
function errorBox(message, err) {
  return h('div', { class: 'card stack', role: 'alert' },
    h('h2', null, message),
    err ? h('p', { class: 'muted small mono' }, errorText(err)) : null,
    h('div', { class: 'row-wrap' },
      linkButton('Home', '#/', { icon: 'home' }),
      button('Reload', { icon: 'undo', onClick: () => window.location.reload() })));
}

async function render() {
  const my = ++token;
  const { path, query } = parseHash(window.location.hash);
  track(path, consumeReplace());
  if (cleanup) {
    const c = cleanup;
    cleanup = null;
    try { await c(); } catch (err) { console.error('View cleanup failed', err); }
  }
  if (my !== token) return;
  const match = matchRoute(path);
  setActions([]);
  setNavActive(path);
  setBack(path === '/' ? null : match ? match.route.parent : '/', canGoBack);
  const root = h('div', { class: 'view' });
  clear(main).append(root);
  window.scrollTo(0, 0);
  if (!match) {
    setTitle('Not found');
    root.append(errorBox('This page does not exist.'));
    return;
  }
  let mod;
  try {
    mod = await match.route.load();
  } catch (err) {
    if (my === token) {
      setTitle('Unavailable');
      root.append(errorBox('This screen could not load.', err));
    }
    return;
  }
  if (my !== token) return;
  const isCurrent = () => my === token;
  try {
    const c = await mod.render({
      params: match.params,
      query,
      root,
      path,
      isCurrent,
      setTitle: (t) => { if (isCurrent()) setTitle(t); },
      setActions: (nodes) => { if (isCurrent()) setActions(nodes); },
    });
    if (!isCurrent()) {
      if (typeof c === 'function') await c();
      return;
    }
    cleanup = typeof c === 'function' ? c : null;
  } catch (err) {
    console.error(err);
    if (!isCurrent()) return;
    setActions([]);
    clear(root).append(errorBox('Something went wrong on this screen.', err));
  }
  if (isCurrent() && (!document.activeElement || document.activeElement === document.body)) {
    main.focus({ preventScroll: true });
  }
}

async function boot() {
  initShell();
  setDbNotifier((m) => toast(m, { timeout: 0, kind: 'error' }));
  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    toast(errorText(e.reason), { kind: 'error' });
  });
  window.addEventListener('error', (e) => {
    if (e.error) toast(errorText(e.error), { kind: 'error' });
  });
  let settings;
  try {
    await ensureSeeded();
    settings = await getSettings();
  } catch (err) {
    setTitle('LNF Run Log');
    clear(main).append(h('div', { class: 'view' }, errorBox('The app could not open its database.', err)));
    return;
  }
  applyTheme(settings.theme);
  window.addEventListener('hashchange', render);
  await render();
  resumeAlarm();
  initPwa();
  if (!settings.persistAsked && !desktopWrapper()) {
    await requestPersist();
    await saveSettings({ persistAsked: true });
  }
}

/**
 * After a reload, a countdown still running in the Log run form keeps its
 * alarm, whichever screen the app opened on.
 */
async function resumeAlarm() {
  try {
    /** @type {import('./core/run-draft.js').RunDraft | null} */
    const d = await getDraft(LOG_DRAFT);
    if (!d || !d.timerStartedAt || !d.timerTarget) return;
    const startedAt = d.timerStartedAt;
    const { armAlarm } = await import('./ui/timer.js');
    armAlarm({
      startedAt, target: d.timerTarget, href: `#/log/${encodeURIComponent(d.toolId)}/${encodeURIComponent(d.templateId)}`,
      stillRunning: () => logTimerRunning(startedAt),
    });
  } catch (err) { console.error('Could not resume the run timer', err); }
}

boot();
