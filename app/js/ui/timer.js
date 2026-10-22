// @ts-check
/**
 * The run timer on Log run. Start counts up; Count down runs from the time
 * already in the form (the last run's, or the time Lookup suggested) and
 * signals at zero with a vibration (where the phone allows it), three short
 * beeps and a message, then keeps counting the overtime. Stop fills the
 * main step's time field with the time that actually passed. While it runs
 * the screen stays awake (Screen Wake Lock), so a phone in its cleanroom
 * pouch does not lock mid-run. The clock is computed from the stored start,
 * so it survives a locked phone or a reload.
 *
 * A countdown's alarm lives here, outside the card: it still goes off, and
 * the screen still stays awake, when the person moves to another screen of
 * the app (one alarm at a time, for the Log run form's timer).
 */
import { h, fill } from './dom.js';
import { button, toast } from './components.js';
import { formatMmSs, formatClock } from '../core/time.js';
import { elapsedSeconds } from '../core/run-draft.js';

/** @type {any} */
let lock = null;
let wanted = false;

/** Keep the screen on while a timer runs; it is asked for again when the page shows. */
async function keepAwake() {
  wanted = true;
  const wl = /** @type {any} */ (navigator).wakeLock;
  if (!wl || lock) return;
  try {
    lock = await wl.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch { /* not allowed now (battery saver, hidden page): the timer still works */ }
}

function letSleep() {
  wanted = false;
  if (lock) lock.release().catch(() => {});
  lock = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (wanted) keepAwake();
    // A page that was frozen in the background may have slept through the alarm's time.
    if (alarm && alarm.timer && Date.now() >= Date.parse(alarm.startedAt) + alarm.target * 1000) {
      clearTimeout(alarm.timer);
      ring(alarm);
    }
  });
}

/** @param {number | number[]} pattern */
function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* no vibration, or not allowed */ }
}

/** @type {AudioContext | null} */
let audio = null;

/** Unlock audio during a tap, so the beeps at zero may play later. */
function primeAudio() {
  try {
    const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!audio && Ctx) audio = new Ctx();
    audio?.resume?.();
  } catch { /* no audio */ }
}

/** @returns {boolean} whether the beeps can sound now */
const audioReady = () => !!audio && audio.state === 'running';

let tapListening = false;

/**
 * After a reload the page may play sound and vibrate only after a tap: the
 * next tap or key press anywhere unlocks them, then the listener goes.
 */
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

/**
 * @typedef {Object} Alarm
 * @property {string} startedAt
 * @property {number} target seconds
 * @property {string} href the form's address, for "Open" when the alarm goes off elsewhere
 * @property {() => Promise<boolean>} stillRunning re-checked when it goes off: the form may have been saved,
 *   discarded or set aside meanwhile
 * @property {ReturnType<typeof setTimeout> | null} timer
 * @property {{close: () => void} | null} message the "Time is up" toast
 */

/** @type {Alarm | null} */
let alarm = null;

/**
 * Arm the alarm for a running countdown (again for the same one does
 * nothing). The screen stays awake until it is disarmed.
 * @param {{startedAt: string, target: number, href: string, stillRunning: () => Promise<boolean>}} a
 */
export function armAlarm(a) {
  if (alarm && alarm.startedAt === a.startedAt && alarm.target === a.target) return;
  disarmAlarm();
  const ms = Date.parse(a.startedAt) + a.target * 1000 - Date.now();
  /** @type {Alarm} */
  const armed = { ...a, timer: null, message: null };
  alarm = armed;
  keepAwake();
  primeOnNextTap();
  // Zero already passed (the app was closed or reloaded meanwhile): say so now.
  if (ms > 0) armed.timer = setTimeout(() => { ring(armed); }, ms);
  else ring(armed);
}

/** @param {Alarm} a */
async function ring(a) {
  a.timer = null;
  let running = true;
  try { running = await a.stillRunning(); } catch { /* signal anyway */ }
  if (alarm !== a) return;
  if (!running) {
    disarmAlarm();
    return;
  }
  buzz([300, 150, 300, 150, 300]);
  beep();
  const away = typeof location !== 'undefined' && !location.hash.startsWith(a.href);
  a.message = toast(`Time is up (${formatMmSs(a.target)}). The clock now counts the extra time; tap Stop on Log run when the tool finishes.`, {
    timeout: 0, action: away ? { label: 'Open', fn: () => { location.hash = a.href; } } : undefined,
  });
}

/** Stop the alarm: the countdown was stopped, saved or discarded. */
export function disarmAlarm() {
  if (!alarm) return;
  if (alarm.timer) clearTimeout(alarm.timer);
  alarm.message?.close();
  alarm = null;
  letSleep();
}

/**
 * @typedef {Object} TimerState
 * @property {string | null} startedAt when the running timer started; null when it is stopped
 * @property {number | null} target seconds a countdown runs for; null counts up
 * @property {boolean} ran the timer ran, and was stopped, in this form
 */

/**
 * @param {{state: TimerState, formSeconds: number | null, onStart: (target: number | null) => void,
 *   onStop: (seconds: number) => void, href: string, stillRunning: () => Promise<boolean>, fills?: string}} o
 *   formSeconds: the time field's value, offered as a countdown; href: the form's address; stillRunning: whether
 *   this form's timer is still the running one; fills: what Stop fills, "the time field" by default
 * @returns {{el: HTMLElement, dispose: () => void}}
 */
export function timerCard(o) {
  const { state } = o;
  const fills = o.fills || 'the time field';
  const clock = h('span', { class: 'timer-clock', role: 'timer', 'aria-live': 'off' });
  const note = h('p', { class: 'field-note' });
  const slot = h('div', { class: 'timer-buttons' });
  const el = h('div', { class: 'card stack timer-card' },
    h('div', { class: 'timer' }, h('span', { class: 'visually-hidden' }, 'Run timer'), clock, slot), note);
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let tick;
  const update = () => {
    if (!state.startedAt) return;
    const secs = elapsedSeconds(state.startedAt, Date.now());
    if (!state.target) {
      clock.textContent = formatMmSs(secs);
      return;
    }
    const left = state.target - secs;
    clock.textContent = left >= 0 ? formatMmSs(left) : `+${formatMmSs(-left)}`;
    el.classList.toggle('timer-over', left < 0);
  };
  if (state.startedAt) {
    const startedAt = state.startedAt;
    update();
    tick = setInterval(update, 1000);
    if (state.target) armAlarm({ startedAt, target: state.target, href: o.href, stillRunning: o.stillRunning });
    else keepAwake();
    // Audio is made only during a tap, so without it the page was reloaded since the countdown started.
    const tap = state.target && !audio ? ' Tap the screen once so the alarm can sound.' : '';
    note.textContent = state.target
      ? `Counting down ${formatMmSs(state.target)} from ${formatClock(startedAt)}. The screen stays on, and the alarm goes off on any screen of the app.${tap} Stop fills ${fills} with the time that passed.`
      : `Started ${formatClock(startedAt)}. The screen stays on. Stop fills ${fills}.`;
    fill(slot, button('Stop', {
      kind: 'danger', icon: 'stop', big: true,
      onClick: () => {
        const secs = elapsedSeconds(startedAt, Date.now());
        disarmAlarm();
        letSleep();
        buzz(80);
        o.onStop(secs);
      },
    }));
  } else {
    const down = typeof o.formSeconds === 'number' && o.formSeconds > 0 ? o.formSeconds : null;
    clock.textContent = state.ran && typeof o.formSeconds === 'number' ? formatMmSs(o.formSeconds) : '0:00';
    note.textContent = state.ran ? `Timer stopped; ${fills} has the result. Start again to time the run again.`
      : down ? `Optional: time the run, or count down ${fills === 'the time field' ? 'the time in the form' : fills}.` : 'Optional: time the run on the tool.';
    fill(slot,
      button('Start', { kind: 'primary', icon: 'play', big: true, onClick: () => { primeAudio(); buzz(40); o.onStart(null); } }),
      down ? button(`Count down ${formatMmSs(down)}`, { icon: 'timer', big: true, onClick: () => { primeAudio(); buzz(40); o.onStart(down); } }) : null);
  }
  // Leaving the card keeps a countdown's alarm (and the awake screen); a count-up timer lets the screen sleep.
  return { el, dispose: () => { clearInterval(tick); if (!alarm) letSleep(); } };
}
