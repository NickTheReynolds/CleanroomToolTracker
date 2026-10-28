// @ts-check
/**
 * The timer card of a run. Start counts up; Count down runs from the time
 * already in the form (the last run's, or the time Lookup suggested). Stop
 * fills the main step's time field with the time that actually passed. The
 * clock is computed from the start stored on the run (core/timers.js), so it
 * survives a locked phone, a reload or another screen, and several runs can
 * have one at once (ui/timers.js keeps the alarms and the screen awake).
 */
import { h, fill } from './dom.js';
import { button } from './components.js';
import { onTick, primeAudio, audioReady } from './timers.js';
import { runTimer, timerClock } from '../core/timers.js';
import { timerField } from '../core/run-draft.js';
import { formatMmSs, formatClock } from '../core/time.js';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Template} Template */

/**
 * @param {{run: Pick<Run, 'params' | 'timer' | 'endedAt'>, template: Template | null | undefined,
 *   onStart: (target: number | null) => void, onStop: () => void, fills?: string, startLabel?: string}} o
 *   onStart: start the timer (a countdown of `target` seconds, or counting up); onStop: stop it;
 *   fills: what Stop fills, "the time field" by default; startLabel: the Start button's words
 * @returns {{el: HTMLElement, dispose: () => void}}
 */
export function timerCard(o) {
  const fills = o.fills || 'the time field';
  const key = timerField(o.template);
  const formSeconds = key && typeof o.run.params?.[key] === 'number' ? /** @type {number} */ (o.run.params[key]) : null;
  const t = runTimer(o.run);
  const clock = h('span', { class: 'timer-clock', role: 'timer', 'aria-live': 'off' });
  const note = h('p', { class: 'field-note' });
  const slot = h('div', { class: 'timer-buttons' });
  const el = h('div', { class: 'card stack timer-card' },
    h('div', { class: 'timer' }, h('span', { class: 'visually-hidden' }, 'Run timer'), clock, slot), note);
  let off = () => {};
  if (t) {
    const update = () => {
      const c = timerClock(t, Date.now());
      clock.textContent = c.text;
      el.classList.toggle('timer-over', c.over);
    };
    update();
    off = onTick(update);
    // Audio is made only during a tap, so without it the page was reloaded since the countdown started.
    const tap = t.target && !audioReady() ? ' Tap the screen once so the alarm can sound.' : '';
    note.textContent = t.target
      ? `Counting down ${formatMmSs(t.target)} from ${formatClock(t.startedAt)}. The alarm goes off on any screen of the app.${tap} Stop fills ${fills} with the time that passed.`
      : `Started ${formatClock(t.startedAt)}. Stop fills ${fills} with the time that passed.`;
    fill(slot, button('Stop', { kind: 'danger', icon: 'stop', big: true, onClick: () => o.onStop() }));
  } else {
    const down = formSeconds !== null && formSeconds > 0 ? formSeconds : null;
    clock.textContent = o.run.endedAt && formSeconds !== null ? formatMmSs(formSeconds) : '0:00';
    note.textContent = o.run.endedAt && formSeconds !== null ? `The run took ${formatMmSs(formSeconds)}. Start again to time it again.`
      : down ? `Optional: time the run, or count down ${fills === 'the time field' ? 'the time in the form' : fills}.` : 'Optional: time the run on the tool.';
    fill(slot,
      button(o.startLabel || 'Start', { kind: 'primary', icon: 'play', big: true, onClick: () => { primeAudio(); o.onStart(null); } }),
      down ? button(`Count down ${formatMmSs(down)}`, { icon: 'timer', big: true, onClick: () => { primeAudio(); o.onStart(down); } }) : null);
  }
  return { el, dispose: () => off() };
}
