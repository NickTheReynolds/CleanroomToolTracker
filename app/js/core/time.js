// @ts-check
/**
 * Time helpers. Dates are stored as ISO 8601 strings; durations as seconds.
 * Display formatting uses the device's local time zone and fixed English
 * month names, so it does not depend on the browser's locale data.
 */

export const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @typedef {string | number | Date} TimeLike */

/**
 * @param {TimeLike | null | undefined} t ISO string, epoch ms or Date
 * @returns {number} epoch ms, or NaN when invalid
 */
export function toMs(t) {
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t;
  if (typeof t === 'string' && t.trim()) return Date.parse(t);
  return NaN;
}

/**
 * @param {unknown} s
 * @returns {boolean} true for a parseable date-time string
 */
export function isIsoDate(s) {
  return typeof s === 'string' && s.length >= 10 && !Number.isNaN(Date.parse(s));
}

/** @returns {string} the current time as an ISO string */
export function isoNow() {
  return new Date().toISOString();
}

/**
 * Age in (fractional) days.
 * @param {TimeLike} at
 * @param {TimeLike} now
 * @returns {number}
 */
export function ageDays(at, now) {
  return (toMs(now) - toMs(at)) / DAY_MS;
}

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * "Oct 6", or "Oct 6, 2025" when the year differs from `now`'s year.
 * @param {TimeLike} at
 * @param {TimeLike} [now]
 * @returns {string}
 */
export function formatDay(at, now) {
  const ms = toMs(at);
  if (Number.isNaN(ms)) return '?';
  const d = new Date(ms);
  const s = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (now !== undefined && new Date(toMs(now)).getFullYear() !== d.getFullYear()) {
    return `${s}, ${d.getFullYear()}`;
  }
  return s;
}

/**
 * 24-hour local clock time, "14:05".
 * @param {TimeLike} at
 * @returns {string}
 */
export function formatClock(at) {
  const d = new Date(toMs(at));
  if (Number.isNaN(d.getTime())) return '?';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * "Oct 6 14:05".
 * @param {TimeLike} at
 * @param {TimeLike} [now]
 * @returns {string}
 */
export function formatDateTime(at, now) {
  return `${formatDay(at, now)} ${formatClock(at)}`;
}

/**
 * Compact age: "now", "12 min", "5 h", "3 d", "8 wk".
 * @param {TimeLike} at
 * @param {TimeLike} now
 * @returns {string}
 */
export function formatAge(at, now) {
  const mins = (toMs(now) - toMs(at)) / 60000;
  if (Number.isNaN(mins)) return '?';
  if (mins < 1) return 'now';
  if (mins < 60) return `${Math.floor(mins)} min`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)} h`;
  const days = hours / 24;
  if (days < 56) return `${Math.floor(days)} d`;
  return `${Math.floor(days / 7)} wk`;
}

/**
 * "just now", "12 min ago", "3 d ago".
 * @param {TimeLike} at
 * @param {TimeLike} now
 * @returns {string}
 */
export function formatAgo(at, now) {
  const age = formatAge(at, now);
  return age === 'now' ? 'just now' : age === '?' ? 'at an unknown time' : `${age} ago`;
}

/**
 * Seconds as "m:ss" ("5:53"), or "h:mm:ss" from one hour up.
 * @param {number} seconds
 * @returns {string}
 */
export function formatMmSs(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
  const sign = seconds < 0 ? '-' : '';
  const total = Math.round(Math.abs(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${sign}${h}:${pad2(m)}:${pad2(s)}` : `${sign}${m}:${pad2(s)}`;
}

/**
 * Parse a duration typed as "m:ss", "h:mm:ss" or a bare number of seconds.
 * Minutes may exceed 59 ("75:00"). Returns null for anything else.
 * @param {string} text
 * @returns {number | null} seconds
 */
export function parseDuration(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3) return null;
  /** @type {number[]} */
  const nums = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    const last = i === parts.length - 1;
    if (!(last ? /^\d+(\.\d+)?$/ : /^\d+$/).test(p)) return null;
    nums.push(Number(p));
  }
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

/**
 * Split seconds into whole minutes and seconds for a mm:ss input.
 * @param {number | null | undefined} seconds
 * @returns {{min: number, sec: number} | null}
 */
export function splitMinSec(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  return { min: Math.floor(total / 60), sec: total % 60 };
}

/**
 * Local calendar date "YYYY-MM-DD" (used in backup file names).
 * @param {TimeLike} at
 * @returns {string}
 */
export function localDateKey(at) {
  const d = new Date(toMs(at));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Value for an <input type="datetime-local">, in local time.
 * @param {TimeLike} at
 * @returns {string} "YYYY-MM-DDTHH:MM", or "" when invalid
 */
export function toLocalInput(at) {
  const d = new Date(toMs(at));
  if (Number.isNaN(d.getTime())) return '';
  return `${localDateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Parse an <input type="datetime-local"> or <input type="date"> value as
 * local time.
 * @param {string} value
 * @returns {string | null} ISO string
 */
export function fromLocalInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
