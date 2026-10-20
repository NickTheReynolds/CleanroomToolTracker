// @ts-check
/**
 * Autosave for in-progress forms: each change is written to IndexedDB
 * after a short pause, and pending saves are flushed when the page is
 * hidden, closed or reloaded, so nothing is lost if the phone locks or the
 * tab is killed.
 */
import { UI } from '../config.js';

/** @type {Set<() => Promise<void>>} */
const pending = new Set();

/**
 * Flush every pending autosave now (before reloading for an update, and
 * whenever the page is hidden).
 * @returns {Promise<void>}
 */
export async function flushAll() {
  await Promise.all([...pending].map((f) => f()));
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('pagehide', () => { flushAll(); });
}

/**
 * @param {() => Promise<void>} save writes the current state
 * @param {number} [delay]
 * @returns {{schedule: () => void, flush: () => Promise<void>, cancel: () => void}}
 */
export function createAutosave(save, delay = UI.AUTOSAVE_MS) {
  wire();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let dirty = false;
  const flush = async () => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    pending.delete(flush);
    try {
      await save();
    } catch (err) {
      dirty = true;
      pending.add(flush);
      throw err;
    }
  };
  return {
    schedule() {
      dirty = true;
      pending.add(flush);
      clearTimeout(timer);
      timer = setTimeout(() => { flush().catch((err) => console.error('Autosave failed', err)); }, delay);
    },
    flush,
    cancel() {
      clearTimeout(timer);
      dirty = false;
      pending.delete(flush);
    },
  };
}
