// @ts-check
/**
 * Run timers (2.0). A timer belongs to a saved run: `run.timer` says when it
 * started, how long it counts down (null counts up) and which device started
 * it. Several runs can have one at once, so a person with two tools going
 * sees both clocks. Stop writes the time that passed into the main step's
 * time field. Older versions keep the field as they keep any field they do
 * not know. Pure: no DOM, no storage, no clock of its own.
 */
import { elapsedSeconds, timerField } from './run-draft.js';
import { formatMmSs } from './time.js';

/** @typedef {import('./types.js').Run} Run */
/** @typedef {import('./types.js').Template} Template */
/** @typedef {import('./types.js').RunTimer} RunTimer */

/**
 * The run's timer when it is well formed, else null.
 * @param {Partial<Run> | null | undefined} run
 * @returns {RunTimer | null}
 */
export function runTimer(run) {
  const t = run && run.timer;
  if (!t || typeof t !== 'object' || typeof t.startedAt !== 'string' || Number.isNaN(Date.parse(t.startedAt))) return null;
  const target = typeof t.target === 'number' && Number.isFinite(t.target) && t.target > 0 ? t.target : null;
  return { startedAt: t.startedAt, target, deviceId: String(t.deviceId || '') };
}

/**
 * The fields that start a timer on a run: the run starts now, and has not
 * ended.
 * @param {{target: number | null, deviceId: string, now?: string}} o target: seconds to count down, null to count up
 * @returns {{timer: RunTimer, startedAt: string, endedAt: null}}
 */
export function startTimer(o) {
  const now = o.now || new Date().toISOString();
  const target = typeof o.target === 'number' && Number.isFinite(o.target) && o.target > 0 ? o.target : null;
  return { timer: { startedAt: now, target, deviceId: o.deviceId }, startedAt: now, endedAt: null };
}

/**
 * The fields that stop a run's timer: no timer, ended now, and the time that
 * passed in the main step's time field (the template's). With `keepTyped`, a
 * time already in the field stays (a run marked complete while its timer
 * runs keeps what the person typed).
 * @param {Partial<Run>} run
 * @param {Template | null | undefined} template
 * @param {{now?: string, keepTyped?: boolean}} [o]
 * @returns {{patch: {timer: null, endedAt: string, params: Record<string, import('./types.js').FieldValue>}, seconds: number}}
 */
export function stopTimer(run, template, o = {}) {
  const now = o.now || new Date().toISOString();
  const t = runTimer(run);
  const seconds = t ? elapsedSeconds(t.startedAt, Date.parse(now)) : 0;
  const key = timerField(template);
  const params = { ...(run.params || {}) };
  if (key && t && !(o.keepTyped && typeof params[key] === 'number')) params[key] = seconds;
  return { patch: { timer: null, endedAt: now, params }, seconds };
}

/**
 * When a countdown reaches zero, as epoch ms; null for a count-up timer.
 * @param {RunTimer} t
 * @returns {number | null}
 */
export function timerDueMs(t) {
  return t.target ? Date.parse(t.startedAt) + t.target * 1000 : null;
}

/**
 * The clock a running timer shows: the time left ("4:31"), the overtime
 * ("+0:12") once a countdown passed zero, or the time elapsed.
 * @param {RunTimer} t
 * @param {number} nowMs
 * @returns {{text: string, over: boolean, seconds: number}} seconds: elapsed
 */
export function timerClock(t, nowMs) {
  const seconds = elapsedSeconds(t.startedAt, nowMs);
  if (!t.target) return { text: formatMmSs(seconds), over: false, seconds };
  const left = t.target - seconds;
  return { text: left >= 0 ? formatMmSs(left) : `+${formatMmSs(-left)}`, over: left < 0, seconds };
}

/**
 * The clock in words, for lists: "4:31 left", "+0:12 over", "12:03".
 * @param {RunTimer} t
 * @param {number} nowMs
 * @returns {string}
 */
export function timerText(t, nowMs) {
  const c = timerClock(t, nowMs);
  if (!t.target) return c.text;
  return c.over ? `${c.text} over` : `${c.text} left`;
}

/**
 * The live runs with a running timer, the one started first first.
 * @param {readonly Run[]} runs
 * @returns {Run[]}
 */
export function runningTimers(runs) {
  return runs.filter((r) => r && !r.deleted && runTimer(r))
    .sort((a, b) => Date.parse(/** @type {RunTimer} */ (runTimer(a)).startedAt) - Date.parse(/** @type {RunTimer} */ (runTimer(b)).startedAt));
}
