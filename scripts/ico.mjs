// @ts-check
/**
 * Windows .ico writer for the desktop build. Every image is stored as a PNG,
 * which Windows Vista and later read at any size. Node built-ins only.
 */
import { drawIcon } from './make-icons.mjs';

/** Edge lengths in the app icon: title bar, taskbar, Start, Explorer views and high-DPI screens. */
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Build an .ico file from square PNG images, smallest first.
 * @param {Map<number, Uint8Array> | Record<number, Uint8Array>} pngBuffersBySize PNG bytes keyed by edge length (1-256 px)
 * @returns {Buffer} the .ico file
 */
export function encodeIco(pngBuffersBySize) {
  const pairs = pngBuffersBySize instanceof Map ? [...pngBuffersBySize] : Object.entries(pngBuffersBySize);
  const images = pairs.map(([size, png]) => ({ size: Number(size), png: Buffer.from(png) })).sort((a, b) => a.size - b.size);
  if (!images.length) throw new Error('An icon needs at least one image.');
  images.forEach(({ size, png }, i) => {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`Icon size ${size} is not 1-256 px.`);
    if (i > 0 && images[i - 1].size === size) throw new Error(`Icon size ${size} appears twice.`);
    if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error(`The ${size} px image is not a PNG.`);
    }
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    if (w !== size || h !== size) throw new Error(`The ${size} px image is ${w} x ${h} px.`);
  });
  // ICONDIR (6 bytes), then one 16-byte ICONDIRENTRY per image, then the images.
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type 1 = icon
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head[e] = size % 256; // width; 0 means 256
    head[e + 1] = size % 256; // height
    head[e + 2] = 0; // palette size: none
    head[e + 3] = 0; // reserved
    head.writeUInt16LE(1, e + 4); // colour planes
    head.writeUInt16LE(32, e + 6); // bits per pixel (RGBA)
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.png)]);
}

/**
 * The desktop app icon: the rounded-square design of icon-512.png at every ICO_SIZES size.
 * @returns {Buffer} the .ico file
 */
export function appIco() {
  return encodeIco(new Map(ICO_SIZES.map((s) => [s, drawIcon(s, { r: 0.34, corner: 0.22 })])));
}
