// @ts-check
/**
 * Number formatting for display. Values are stored at full precision and
 * rounded only here (3 significant figures by default).
 */

/**
 * Round to `sig` significant figures without dropping integer digits
 * (1234.5 -> "1235"), then strip trailing zeros ("71.0" -> "71").
 * @param {number | null | undefined} x
 * @param {number} [sig]
 * @returns {string} "" for missing or non-finite values
 */
export function fmtNum(x, sig = 3) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '';
  if (x === 0) return '0';
  const digits = Math.floor(Math.log10(Math.abs(x))) + 1;
  const decimals = Math.min(12, Math.max(0, sig - digits));
  let s = x.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s.replace(/^-/, '−');
}

/**
 * Signed number with an explicit "+" or "−" ("+50", "−25").
 * @param {number} x
 * @param {number} [sig]
 * @returns {string}
 */
export function fmtSigned(x, sig = 3) {
  const s = fmtNum(x, sig);
  if (!s || s === '0' || s.startsWith('−')) return s;
  return `+${s}`;
}

/**
 * Join a formatted number and its unit: "85 nm/min", "1.73%", "20 °C".
 * @param {string} text
 * @param {string | undefined} unit
 * @returns {string}
 */
export function withUnit(text, unit) {
  if (!text) return '';
  if (!unit) return text;
  return unit === '%' ? `${text}%` : `${text} ${unit}`;
}

/**
 * Format a value with its unit at 3 significant figures.
 * @param {number | null | undefined} x
 * @param {string | undefined} unit
 * @returns {string}
 */
export function fmtValue(x, unit) {
  return withUnit(fmtNum(x), unit);
}

/**
 * A range "71–94" with an optional unit.
 * @param {number} lo
 * @param {number} hi
 * @param {string} [unit]
 * @returns {string}
 */
export function fmtRange(lo, hi, unit) {
  return withUnit(`${fmtNum(lo)}–${fmtNum(hi)}`, unit);
}

/**
 * Decimal places needed to write x exactly (0.25 -> 2, 1e-7 -> 7).
 * @param {number} x
 * @returns {number}
 */
function decimalsOf(x) {
  const s = String(x);
  const e = s.indexOf('e-');
  if (e >= 0) return Number(s.slice(e + 2)) + Math.max(0, s.slice(0, e).split('.')[1]?.length || 0);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * One stepper press: value ± step, rounded to the precision of the step or
 * value (so 0.1 + 0.2 shows 0.3) and clamped to [min, max].
 * @param {number} value
 * @param {number} step
 * @param {1 | -1} dir
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number}
 */
export function stepValue(value, step, dir, min, max) {
  const d = Math.min(10, Math.max(decimalsOf(step), decimalsOf(value)));
  let n = Number((value + dir * step).toFixed(d));
  if (typeof min === 'number' && n < min) n = min;
  if (typeof max === 'number' && n > max) n = max;
  return Object.is(n, -0) ? 0 : n;
}

/**
 * Parse a number typed by a person: accepts a decimal comma and the Unicode
 * minus sign. Returns null for blank or invalid text.
 * @param {unknown} text
 * @returns {number | null}
 */
export function parseNumber(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const t = String(text ?? '').trim().replace(/−/g, '-').replace(',', '.');
  if (!t || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
