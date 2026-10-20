// @ts-check
/**
 * Small statistics helpers. Every function returns null instead of NaN or
 * Infinity when its inputs do not define a value.
 */

/**
 * @param {unknown} x
 * @returns {x is number} true for a finite number
 */
export function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * @param {number[]} xs
 * @returns {number}
 */
export function sum(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/**
 * Arithmetic mean.
 * @param {number[]} xs
 * @returns {number | null}
 */
export function mean(xs) {
  return xs.length ? sum(xs) / xs.length : null;
}

/**
 * Sample standard deviation (n − 1 denominator).
 * @param {number[]} xs
 * @returns {number | null} null when fewer than 2 values
 */
export function sampleStd(xs) {
  if (xs.length < 2) return null;
  const m = /** @type {number} */ (mean(xs));
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / (xs.length - 1));
}

/**
 * @param {number[]} xs
 * @returns {number | null}
 */
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {number[]} xs
 * @returns {{min: number, max: number} | null}
 */
export function minMax(xs) {
  if (!xs.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { min, max };
}

/**
 * Weighted arithmetic mean.
 * @param {number[]} xs
 * @param {number[]} ws non-negative weights, same length as xs
 * @returns {number | null} null when the weights sum to 0
 */
export function weightedMean(xs, ws) {
  let sw = 0;
  let swx = 0;
  for (let i = 0; i < xs.length; i++) {
    sw += ws[i];
    swx += ws[i] * xs[i];
  }
  return sw > 0 ? swx / sw : null;
}

/**
 * Weighted standard deviation about the weighted mean:
 * sqrt( sum w (x − mean)^2 / sum w ).
 * @param {number[]} xs
 * @param {number[]} ws
 * @returns {number | null}
 */
export function weightedStd(xs, ws) {
  const m = weightedMean(xs, ws);
  if (m === null) return null;
  let sw = 0;
  let ss = 0;
  for (let i = 0; i < xs.length; i++) {
    sw += ws[i];
    ss += ws[i] * (xs[i] - m) ** 2;
  }
  return Math.sqrt(ss / sw);
}

/**
 * Ordinary least-squares line y = intercept + slope * x.
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {{slope: number, intercept: number, n: number} | null} null when
 *   fewer than 2 points or all x are equal
 */
export function linearFit(xs, ys) {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const mx = sum(xs) / n;
  const my = sum(ys) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, n };
}
