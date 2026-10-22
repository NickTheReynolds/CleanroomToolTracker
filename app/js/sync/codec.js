// @ts-check
/**
 * Sync file encoding: JSON, gzip-compressed when the browser can
 * (CompressionStream). Reading detects gzip by its magic bytes, so files
 * from devices without compression still read everywhere.
 */

/** @returns {boolean} the browser has CompressionStream and DecompressionStream */
export function canGzip() {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/**
 * @param {Uint8Array} bytes
 * @param {TransformStream<Uint8Array, Uint8Array>} stream
 * @returns {Promise<Uint8Array>}
 */
async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * @param {unknown} obj
 * @param {boolean} [gzip]
 * @returns {Promise<Uint8Array>}
 */
export async function encodeSyncFile(obj, gzip = canGzip()) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  return gzip ? pipe(json, new CompressionStream('gzip')) : json;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<any>}
 * @throws {Error} on a compressed file without DecompressionStream, or bad JSON
 */
export async function decodeSyncFile(bytes) {
  let data = bytes;
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    if (!canGzip()) throw new Error('This browser cannot read compressed sync files. Update it, then sync again.');
    data = await pipe(data, new DecompressionStream('gzip'));
  }
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new Error('A sync file in the repository is damaged (not valid JSON).');
  }
}
