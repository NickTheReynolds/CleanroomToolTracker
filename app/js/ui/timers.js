// @ts-check
/**
 * Running timers (2.0): the registry of every run with a timer, their
 * alarms, the screen kept awake while one runs, the clock in the app bar and
 * the sheet behind it. A timer lives on its saved run (core/timers.js), so
 * several can run at once (two tools going), and a reload, another screen or
 * another device loses none. Only the device that started a countdown rings
 * when it reaches zero: a vibration where the phone allows it, three beeps
 * and a message with Open, then the clock counts the overtime.
 */
import { h, fill } from './dom.js';
import { icon } from './icons.js';
import { button, toast, sheet, emptyState } from './components.js';
import { listRuns, getRun, getTool, getTemplate, saveRun, getSettings, listTools, listProjects } from '../data/repo.js';
import { runTimer, runningTimers, startTimer, stopTimer, timerDueMs, timerText, timerClock } from '../core/timers.js';
import { runLinks } from '../core/projects.js';
import { stepRoute } from '../core/attachments.js';
import { formatMmSs } from '../core/time.js';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').RunTimer} RunTimer */
/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Project} Project */

/** @type {any} */
let lock = null;
let wanted = false;

/** Keep the screen on while a timer runs; asked for again when the page shows. */
async function keepAwake() {
  wanted = true;
  const wl = /** @type {any} */ (navigator).wakeLock;
  if (!wl || lock) return;
  try {
    lock = await wl.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch { /* not allowed now (battery saver, hidden page): the timers still work */ }
}

function letSleep() {
  wanted = false;
  if (lock) lock.release().catch(() => {});
  lock = null;
}

/** @param {number | number[]} pattern */
export function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* no vibration, or not allowed */ }
}

/** @type {AudioContext | null} */
let audio = null;

/** Unlock audio during a tap, so the beeps at zero may play later. */
export function primeAudio() {
  try {
    const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!audio && Ctx) audio = new Ctx();
    audio?.resume?.();
  } catch { /* no audio */ }
}

/** @returns {boolean} whether the beeps can sound now */
export const audioReady = () => !!audio && audio.state === 'running';

let tapListening = false;

/** After a reload the page may play sound only after a tap: the next tap or key press anywhere unlocks it. */
function primeOnNextTap() {
  if (tapListening || audioReady() || typeof document === 'undefined') return;
  tapListening = true;
  const onTap = () => {
    primeAudio();
    if (!audioReady()) return;
    document.removeEventListener('click', onTap, true);
    document.removeEventListener('keydown', onTap, true);
    tapListening = false;
  };
  document.addEventListener('click', onTap, true);
  document.addEventListener('keydown', onTap, true);
}

/** Three short beeps. On an iPhone they play even in silent mode where Safari allows it. */
function beep() {
  if (!audio) return;
  const session = /** @type {any} */ (navigator).audioSession;
  try { if (session) session.type = 'playback'; } catch { /* not supported */ }
  try {
    for (let i = 0; i < 3; i++) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.2;
      osc.connect(gain).connect(audio.destination);
      const at = audio.currentTime + i * 0.3;
      osc.start(at);
      osc.stop(at + 0.18);
    }
  } catch { /* audio blocked */ }
  setTimeout(() => { try { if (session) session.type = 'auto'; } catch { /* not supported */ } }, 1500);
}

/** @type {Run[]} the live runs with a running timer */
let running = [];
let deviceId = '';
/** @typedef {{startedAt: string, target: number, timeout: ReturnType<typeof setTimeout> | null, message: {close: () => void} | null}} Alarm */
/** @type {Map<string, Alarm>} by run id */
const alarms = new Map();
/** @type {Set<() => void>} clocks on screen, updated once a second while a timer runs */
const tickers = new Set();
/** @type {ReturnType<typeof setInterval> | undefined} */
let ticking;

/**
 * Be told once a second while a timer runs, and whenever the timers change.
 * @param {() => void} fn
 * @returns {() => void} stop listening
 */
export function onTick(fn) {
  tickers.add(fn);
  return () => { tickers.delete(fn); };
}

const tickAll = () => { for (const f of tickers) f(); drawChip(); };

/** @returns {Run[]} the runs with a running timer, the one started first first */
export function runningRuns() {
  return running;
}

/** The page a timer opens: the project step the run carries out, else the run. */
export const timerHref = (/** @type {Run} */ run) => `#${stepRoute(run) || `/run/${encodeURIComponent(run.id)}`}`;

/**
 * Read the running timers from storage: at start, after every screen change
 * and after a timer starts or stops. Arms this device's countdown alarms.
 * @returns {Promise<void>}
 */
export async function loadTimers() {
  const [runs, s] = await Promise.all([listRuns(), getSettings()]);
  deviceId = s.deviceId;
  setRunning(runningTimers(runs));
}

/** @param {Run[]} list */
function setRunning(list) {
  running = list;
  const ids = new Set(list.map((r) => r.id));
  for (const id of [...alarms.keys()]) if (!ids.has(id)) disarm(id);
  for (const r of list) {
    const t = runTimer(r);
    if (t && t.target && t.deviceId === deviceId) arm(r.id, t);
    else disarm(r.id);
  }
  if (list.length) {
    keepAwake();
    if (!ticking) ticking = setInterval(tickAll, 1000);
  } else {
    letSleep();
    clearInterval(ticking);
    ticking = undefined;
  }
  tickAll();
}

/** @param {string} id @param {RunTimer} t */
function arm(id, t) {
  const cur = alarms.get(id);
  if (cur && cur.startedAt === t.startedAt && cur.target === t.target) return;
  disarm(id);
  /** @type {Alarm} */
  const a = { startedAt: t.startedAt, target: /** @type {number} */ (t.target), timeout: null, message: null };
  alarms.set(id, a);
  primeOnNextTap();
  const ms = /** @type {number} */ (timerDueMs(t)) - Date.now();
  // Zero already passed (the app was closed or reloaded meanwhile): say so now.
  if (ms > 0) a.timeout = setTimeout(() => { ring(id, a); }, ms);
  else ring(id, a);
}

/** @param {string} id */
function disarm(id) {
  const a = alarms.get(id);
  if (!a) return;
  if (a.timeout) clearTimeout(a.timeout);
  a.message?.close();
  alarms.delete(id);
}

/**
 * @param {string} id
 * @param {Alarm} a
 */
async function ring(id, a) {
  a.timeout = null;
  // The timer may have been stopped meanwhile, here or on another device: check the run as stored now.
  /** @type {Run | null} */
  let run = null;
  try { run = await getRun(id); } catch { /* ring anyway */ }
  if (alarms.get(id) !== a) return;
  const t = run ? runTimer(run) : null;
  if (run && (!t || t.startedAt !== a.startedAt)) {
    disarm(id);
    setRunning(running.filter((r) => r.id !== id));
    return;
  }
  buzz([300, 150, 300, 150, 300]);
  beep();
  let name = '';
  try { name = run ? (await getTool(run.toolId))?.shortName || (await getTool(run.toolId))?.name || '' : ''; } catch { /* no name */ }
  const href = run ? timerHref(run) : '';
  const away = href && typeof location !== 'undefined' && !location.hash.startsWith(href);
  a.message = toast(`Time is up${name ? ` on ${name}` : ''} (${formatMmSs(a.target)}). The clock now counts the extra time; tap Stop when the tool finishes.`, {
    timeout: 0, action: away ? { label: 'Open', fn: () => { location.hash = href; } } : undefined,
  });
}

/**
 * Start a timer on a saved run: the run starts now and is saved with the
 * timer, so the clock survives a locked phone, a reload or another screen.
 * @param {Run} run as stored now, with any edits
 * @param {number | null} target seconds to count down, null to count up
 * @returns {Promise<Run>} the saved run
 */
export async function startRunTimer(run, target) {
  const s = await getSettings();
  const saved = await saveRun({ ...run, ...startTimer({ target, deviceId: s.deviceId }) });
  buzz(40);
  await loadTimers();
  return saved;
}

/**
 * Stop a run's timer: the time that passed goes into the main step's time
 * field and the run ends now.
 * @param {Run} run
 * @param {import('../core/types.js').Template | null | undefined} template
 * @returns {Promise<{run: Run, seconds: number}>}
 */
export async function stopRunTimer(run, template) {
  const { patch, seconds } = stopTimer(run, template);
  const saved = await saveRun({ ...run, ...patch });
  buzz(80);
  disarm(run.id);
  await loadTimers();
  return { run: saved, seconds };
}

/** The app bar's clock: how many timers run and the soonest countdown (else the first timer's elapsed time). */
function drawChip() {
  const btn = document.getElementById('nav-timers');
  const text = document.getElementById('nav-timers-text');
  if (!btn || !text) return;
  if (!running.length) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const now = Date.now();
  const timers = /** @type {RunTimer[]} */ (running.map((r) => runTimer(r)).filter(Boolean));
  const down = timers.filter((t) => t.target).sort((a, b) => /** @type {number} */ (timerDueMs(a)) - /** @type {number} */ (timerDueMs(b)));
  const show = down[0] || timers[0];
  const c = timerClock(show, now);
  text.textContent = running.length > 1 ? `${running.length} · ${c.text}` : c.text;
  btn.classList.toggle('timer-over', c.over);
  btn.setAttribute('aria-label', `${running.length} timer${running.length === 1 ? '' : 's'} running: ${timerText(show, now)}. Show them`);
}

/**
 * Wire the app bar's clock once at start-up, and keep the screen awake and
 * the alarms honest when the page shows again after being hidden.
 */
export function initTimers() {
  document.getElementById('nav-timers')?.addEventListener('click', () => { openTimersSheet(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (wanted) keepAwake();
    // A page frozen in the background may have slept through an alarm's time.
    for (const [id, a] of alarms) {
      if (a.timeout && Date.now() >= Date.parse(a.startedAt) + a.target * 1000) {
        clearTimeout(a.timeout);
        ring(id, a);
      }
    }
    loadTimers();
  });
  loadTimers();
}

/**
 * "LAM 9400 · Shadow mask 3, step 3" for a run with a timer.
 * @param {Run} run
 * @param {Map<string, Tool>} tools
 * @param {Map<string, Project>} projects
 * @returns {{title: string, sub: string}}
 */
function timerWords(run, tools, projects) {
  const tool = tools.get(run.toolId);
  const link = runLinks(run)[0];
  const p = link ? projects.get(link.projectId) : null;
  const i = p ? p.steps.findIndex((s) => s.id === link?.stepId) : -1;
  return {
    title: tool ? tool.shortName || tool.name : 'Run',
    sub: p ? `${p.name}${i >= 0 ? `, step ${i + 1}: ${p.steps[i].title}` : ''}` : run.recipe || '',
  };
}

/**
 * The running timers as a strip of pills, each a link to its run, for Home
 * and a project's page. Empty (and hidden) when none runs.
 * @param {{tools: Map<string, Tool>, projects: Map<string, Project>, filter?: (run: Run) => boolean}} o
 * @returns {{el: HTMLElement, dispose: () => void}}
 */
export function timerStrip(o) {
  const el = h('div', { class: 'timer-strip', role: 'list', 'aria-label': 'Running timers' });
  const draw = () => {
    const list = running.filter(o.filter || (() => true));
    el.hidden = !list.length;
    const now = Date.now();
    fill(el, list.map((r) => {
      const t = /** @type {RunTimer} */ (runTimer(r));
      const w = timerWords(r, o.tools, o.projects);
      const c = timerClock(t, now);
      return h('a', { class: ['timer-pill', c.over && 'timer-over'], href: timerHref(r), role: 'listitem' },
        icon('timer', { size: 20 }), h('span', { class: 'timer-pill-clock' }, c.text),
        h('span', { class: 'timer-pill-text' }, h('strong', null, w.title), w.sub ? ` · ${w.sub}` : ''));
    }));
  };
  draw();
  return { el, dispose: onTick(draw) };
}

/** Every running timer, with its clock, Open and Stop. */
export async function openTimersSheet() {
  const [tools, projects] = await Promise.all([listTools({ includeArchived: true }), listProjects()]);
  const T = new Map(tools.map((t) => [t.id, t]));
  const P = new Map(projects.map((p) => [p.id, p]));
  const body = h('div', { class: 'stack' });
  const draw = () => {
    const now = Date.now();
    fill(body, running.length ? h('div', { class: 'list' }, running.map((r) => {
      const t = /** @type {RunTimer} */ (runTimer(r));
      const w = timerWords(r, T, P);
      const c = timerClock(t, now);
      return h('div', { class: 'row timer-row' },
        h('span', { class: ['row-lead', c.over && 'timer-over'] }, icon('timer')),
        h('a', { class: 'row-main row-tap', href: timerHref(r) },
          h('span', { class: 'row-title' }, w.title),
          h('span', { class: ['row-sub', 'timer-row-clock', c.over && 'timer-over'] }, timerText(t, now)),
          w.sub ? h('span', { class: 'row-sub' }, w.sub) : null),
        button('Stop', {
          icon: 'stop',
          onClick: async () => {
            try {
              const tpl = r.templateId ? await getTemplate(r.templateId) : null;
              const res = await stopRunTimer(r, tpl);
              toast(`Stopped at ${formatMmSs(res.seconds)}. The time is in the run.`, { action: { label: 'Open', fn: () => { location.hash = timerHref(r); } } });
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), { kind: 'error' });
            }
          },
        }));
    })) : emptyState('No timer is running.'));
  };
  draw();
  const off = onTick(draw);
  sheet('Running timers', [body, h('p', { class: 'muted small' }, 'Each timer runs on its own run. Open one to see the run; Stop puts the time that passed into it.')],
    { onClose: off });
}
