// @ts-check
/**
 * Photo resizing: scale a camera image so its long edge is at most
 * PHOTO_MAX_EDGE and re-encode it as JPEG at PHOTO_QUALITY with a canvas.
 * An <img> element applies the EXIF orientation, so portrait photos stay
 * upright.
 */
import { DEFAULTS } from '../config.js';

/**
 * Target size for an image scaled to fit `maxEdge` on its long edge (never
 * enlarged).
 * @param {number} width
 * @param {number} height
 * @param {number} maxEdge
 * @returns {{width: number, height: number}}
 */
export function fitWithin(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * @param {Blob} file
 * @returns {Promise<{img: HTMLImageElement, url: string}>}
 */
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('This file is not an image the browser can read.');
  }
  return { img, url };
}

/**
 * @param {Blob} file a camera photo or picked image
 * @param {number} [maxEdge]
 * @param {number} [quality] JPEG quality 0–1
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function resizePhoto(file, maxEdge = DEFAULTS.PHOTO_MAX_EDGE, quality = DEFAULTS.PHOTO_QUALITY) {
  const { img, url } = await loadImage(file);
  try {
    const size = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Could not create a canvas to resize the photo.');
    g.drawImage(img, 0, 0, size.width, size.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))), 'image/jpeg', quality);
    });
    return { blob: /** @type {Blob} */ (blob), ...size };
  } finally {
    URL.revokeObjectURL(url);
  }
}
