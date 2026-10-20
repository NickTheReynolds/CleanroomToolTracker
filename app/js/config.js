// @ts-check
/**
 * Every tunable constant lives here (spec Section 10). This module is pure
 * data and imports nothing, so core modules may import it and still run
 * unchanged in Node.
 */

export const DEFAULTS = Object.freeze({
  HALF_LIFE_DAYS: 30,
  EVENT_PENALTY: 0.5,
  TOP_K: 5,
  CATEGORICAL_PENALTY: 1.0,
  MISSING_PENALTY: 1.0,
  DIFF_THRESHOLD: 0.1,
  SENS_MIN_DELTA: 0.25,
  SENS_MAX_OTHER: 0.1,
  TREND_MAX_DISTANCE: 1.0,
  TREND_WINDOW_DAYS: 90,
  TREND_MIN_N: 4,
  CONF_HIGH_MIN_MATCHES: 3,
  CONF_HIGH_MAX_D: 0.5,
  CONF_HIGH_MAX_AGE_DAYS: 60,
  CONF_LOW_MIN_D: 1.5,
  BACKUP_REMINDER_DAYS: 14,
  PHOTO_MAX_EDGE: 1600,
  PHOTO_QUALITY: 0.8,
});

/** @typedef {typeof DEFAULTS} Config */

/**
 * The constants a user may override in Settings -> Lookup tuning, with the
 * settings key that stores each one and its allowed range.
 */
export const TUNABLE = Object.freeze([
  { key: 'HALF_LIFE_DAYS', setting: 'halfLifeDays', label: 'Half-life', unit: 'days', min: 1, max: 3650, step: 5 },
  { key: 'EVENT_PENALTY', setting: 'eventPenalty', label: 'Event penalty', unit: '', min: 0, max: 1, step: 0.05 },
  { key: 'TOP_K', setting: 'topK', label: 'Top K', unit: 'runs', min: 1, max: 50, step: 1 },
]);

/**
 * Merge Settings overrides onto the defaults. Invalid or out-of-range
 * values are ignored, so a corrupt setting can never break lookup.
 * @param {Record<string, unknown> | null | undefined} tuning e.g. {halfLifeDays: 45}
 * @returns {Config}
 */
export function withTuning(tuning) {
  /** @type {Record<string, number>} */
  const cfg = { ...DEFAULTS };
  for (const t of TUNABLE) {
    const v = tuning ? tuning[t.setting] : undefined;
    if (typeof v === 'number' && Number.isFinite(v) && v >= t.min && v <= t.max) {
      cfg[t.key] = t.key === 'TOP_K' ? Math.round(v) : v;
    }
  }
  return /** @type {Config} */ (cfg);
}

/** UI timing and size constants (not part of the lookup contract). */
export const UI = Object.freeze({
  UNDO_MS: 5000,
  AUTOSAVE_MS: 300,
  RECENT_RUNS_HOME: 5,
  HISTORY_PAGE: 50,
  STEPPER_DELAY_MS: 400,
  STEPPER_REPEAT_MS: 70,
  ERASE_WORD: 'ERASE',
});
