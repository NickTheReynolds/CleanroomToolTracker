// @ts-check
/**
 * Field values: which ones are worth storing, and a record of only those.
 * Shared by the run form helpers (run-draft.js) and run steps (run-steps.js).
 */

/** @typedef {import('./types.js').FieldValue} FieldValue */

/**
 * @param {FieldValue | undefined} v
 * @returns {boolean} true for a value worth storing
 */
export function isSet(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'boolean';
}

/**
 * Keep only set values (text trimmed).
 * @param {Record<string, FieldValue>} values
 * @returns {Record<string, FieldValue>}
 */
export function compactValues(values) {
  /** @type {Record<string, FieldValue>} */
  const out = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (isSet(v)) out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}
