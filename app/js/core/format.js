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

/**
 * Values pasted from a metrology tool or a spreadsheet, in order: one per
 * line, cell or word ("1002 998.5 1004", a column of cells, "C=1002;
 * N=998"). The comma is read line by line: on a line whose values are
 * separated by spaces, tabs or semicolons it is a decimal comma ("1002,5
 * 998,3", "1;1002,3"); on a line with only commas it separates values
 * ("1002,998,1004", a CSV row "1,1002.3"), unless every comma line of the
 * paste is one number with a decimal comma (a column of "1002,5"). A site
 * name before "=" or ":" is kept.
 * Words such as units and header rows are skipped, and so are digits inside
 * a word or a date ("SiO2", "W-1", "2026-10-21"). When every line holds two
 * numbers, as in a two-column export of site number and value, the first
 * is the site.
 * @param {string} text
 * @returns {{site: string | null, value: number}[]}
 */
export function parseNumberList(text) {
  const raw = String(text ?? '').replace(/−/g, '-').split(/\r?\n/);
  const commaOnly = (/** @type {string} */ s) => s.includes(',') && !/[ \t;]/.test(s);
  const lone = (/** @type {string} */ s) => /^[-+]?\d+,\d+$/.test(s);
  // Decided once per paste: when any comma line is not a single number (a CSV header or row), commas
  // separate on every such line, so "1,1002" under "Site,Thickness" is site 1 and 1002.
  const separating = raw.some((l) => commaOnly(l.trim()) && !lone(l.trim()));
  const t = raw.map((line) => {
    const s = line.trim();
    return commaOnly(s) && (separating || !lone(s)) ? line.replace(/,/g, ' ') : line;
  }).join('\n');
  const re = /(?:([A-Za-z][\w-]{0,15})\s*[=:]\s*)?(?<![A-Za-z\d.,-])([-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[-+]?\d+)?)(?!\d|-\d)/gi;
  const lines = t.split(/\r?\n/).map((l) => [...l.matchAll(re)]).filter((ms) => ms.length);
  if (lines.length >= 2 && lines.every((ms) => ms.length === 2 && !ms[0][1] && !ms[1][1])) {
    return lines.map((ms) => ({ site: ms[0][2], value: parseNumber(ms[1][2]) }))
      .filter((p) => p.value !== null).map((p) => ({ site: p.site, value: /** @type {number} */ (p.value) }));
  }
  /** @type {{site: string | null, value: number}[]} */
  const out = [];
  for (const m of t.matchAll(re)) {
    const value = parseNumber(m[2]);
    if (value !== null) out.push({ site: m[1] || null, value });
  }
  return out;
}
