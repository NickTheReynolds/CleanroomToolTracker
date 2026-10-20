#!/usr/bin/env node
// @ts-check
/**
 * Draw the app icons and encode them as PNG with node:zlib only (iOS needs
 * real PNG touch icons). The glyph is a wafer with a die grid and one
 * highlighted die. Writes app/icons/{icon.svg, icon-192.png, icon-512.png,
 * maskable-512.png, apple-touch-icon.png}.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'icons');
const BG = [11, 93, 122];
const WAFER = [255, 255, 255];
const ACCENT = [242, 177, 52];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode 8-bit RGBA pixels as a PNG file.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Colour of one sample point (unit square coordinates), or null if transparent.
 * @param {number} u
 * @param {number} v
 * @param {{r: number, corner: number}} o wafer radius and background corner radius (0 = square)
 * @returns {number[] | null}
 */
function sample(u, v, o) {
  if (o.corner > 0) {
    const cx = Math.min(Math.max(u, o.corner), 1 - o.corner);
    const cy = Math.min(Math.max(v, o.corner), 1 - o.corner);
    if ((u - cx) ** 2 + (v - cy) ** 2 > o.corner ** 2) return null;
  }
  const dx = u - 0.5;
  const dy = v - 0.5;
  const inWafer = dx * dx + dy * dy <= o.r * o.r && dy <= o.r * 0.9;
  if (!inWafer) return BG;
  const g = o.r * 0.42;
  const lw = o.r * 0.07;
  const onLine = (/** @type {number} */ d) => Math.abs(d - Math.round(d / g) * g) < lw / 2;
  if (onLine(dx) || onLine(dy)) return BG;
  if (dx > 0 && dx < g && dy < 0 && dy > -g) return ACCENT;
  return WAFER;
}

/**
 * Render an icon with 4 × 4 supersampling.
 * @param {number} size
 * @param {{r: number, corner: number}} o
 * @returns {Buffer} PNG bytes
 */
export function drawIcon(size, o) {
  const px = new Uint8Array(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let gr = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, o);
          if (!c) continue;
          r += c[0];
          gr += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(gr / a);
        px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return encodePng(size, size, px);
}

/** The same design as SVG (512 × 512 user units). */
export function iconSvg() {
  const s = 512;
  const c = s / 2;
  const r = 0.34 * s;
  const fy = c + r * 0.9;
  const half = Math.sqrt(r * r - (r * 0.9) ** 2);
  const g = r * 0.42;
  const lw = r * 0.07;
  const hex = (/** @type {number[]} */ rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  const lines = [];
  for (let k = -2; k <= 2; k++) {
    const p = (c + k * g).toFixed(1);
    lines.push(`<path d="M${p} 0V${s}M0 ${p}H${s}"/>`);
  }
  const f = (/** @type {number} */ n) => n.toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${0.22 * s}" fill="${hex(BG)}"/>
  <clipPath id="wafer"><path d="M${f(c - half)} ${f(fy)}A${f(r)} ${f(r)} 0 1 1 ${f(c + half)} ${f(fy)}Z"/></clipPath>
  <g clip-path="url(#wafer)">
    <rect width="${s}" height="${s}" fill="${hex(WAFER)}"/>
    <rect x="${f(c)}" y="${f(c - g)}" width="${f(g)}" height="${f(g)}" fill="${hex(ACCENT)}"/>
    <g stroke="${hex(BG)}" stroke-width="${f(lw)}">${lines.join('')}</g>
  </g>
</svg>
`;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const files = {
    'icon-192.png': drawIcon(192, { r: 0.34, corner: 0.22 }),
    'icon-512.png': drawIcon(512, { r: 0.34, corner: 0.22 }),
    'maskable-512.png': drawIcon(512, { r: 0.27, corner: 0 }),
    'apple-touch-icon.png': drawIcon(180, { r: 0.32, corner: 0 }),
    'icon.svg': Buffer.from(iconSvg()),
  };
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(OUT, name), data);
    console.log(`wrote app/icons/${name} (${data.length} bytes)`);
  }
}

const isMain = () => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (isMain()) main();
