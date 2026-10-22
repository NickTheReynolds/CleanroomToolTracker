// @ts-check
/**
 * A QR code as inline SVG, laid out in module units so it scales without
 * blurring. Always black modules on white with the 4-module quiet zone,
 * whatever the theme: phone cameras need that contrast.
 */
import { svg } from './dom.js';
import { encodeQr } from '../core/qr.js';

/** Light modules around the symbol, as the standard requires. */
export const QUIET_ZONE = 4;

/**
 * Path data for the dark modules, one rectangle per horizontal run, offset
 * by the quiet zone: "M{x} {y}h{run}v1h-{run}z".
 * @param {boolean[][]} modules
 * @returns {string}
 */
export function qrPath(modules) {
  const parts = [];
  for (let y = 0; y < modules.length; y++) {
    const row = modules[y];
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let end = x + 1;
      while (end < row.length && row[end]) end++;
      parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  }
  return parts.join('');
}

/**
 * Build an <svg> showing text as a QR code.
 * @param {string} text
 * @param {{ecc?: import('../core/qr.js').Ecc, label?: string, size?: number}} [opts]
 *   ecc defaults to M; label is the accessible name (default: the text); size in CSS pixels
 * @returns {SVGElement}
 * @throws {RangeError} when the text is too long for a QR code
 */
export function qrSvg(text, { ecc, label, size = 240 } = {}) {
  const qr = encodeQr(text, { ecc });
  const n = qr.size + 2 * QUIET_ZONE;
  return svg('svg', {
    class: 'qr',
    width: size,
    height: size,
    viewBox: `0 0 ${n} ${n}`,
    'shape-rendering': 'crispEdges',
    role: 'img',
    'aria-label': label || text,
  },
  svg('rect', { width: n, height: n, fill: '#fff' }),
  svg('path', { d: qrPath(qr.modules), fill: '#000' }));
}
