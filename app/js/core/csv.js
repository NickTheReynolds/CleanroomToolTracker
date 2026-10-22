// @ts-check
/** CSV text (RFC 4180) that spreadsheets open safely. */

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell (RFC 4180). Text that a spreadsheet would run as a formula
 * (starting with =, +, -, an at sign, a tab or CR) gets a leading apostrophe unless the
 * whole text is a plain number such as "-5". Cells holding a comma, quote
 * or line break are quoted, with quotes doubled.
 * @param {unknown} v
 * @returns {string}
 */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {unknown[][]} rows header row first
 * @returns {string} CSV text with CRLF line ends and no byte-order mark
 *   (the caller adds one, U+FEFF, for Excel)
 */
export function toCsv(rows) {
  return rows.map((r) => `${r.map((v) => csvCell(v)).join(',')}\r\n`).join('');
}
