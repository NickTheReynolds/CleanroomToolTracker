// @ts-check
/** Record ids: RFC 4122 version 4 UUIDs. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Format 16 random bytes as a version 4 UUID (sets the version and variant bits).
 * @param {Uint8Array} bytes exactly 16 bytes
 * @returns {string}
 */
export function uuidFromBytes(bytes) {
  if (bytes.length !== 16) throw new Error('uuidFromBytes needs 16 bytes');
  const b = Uint8Array.from(bytes);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A new version 4 UUID. crypto.randomUUID only exists in secure contexts
 * (HTTPS, localhost), so plain-HTTP testing on a LAN falls back to
 * getRandomValues, and to Math.random only if neither exists.
 * @param {{randomUUID?: () => string, getRandomValues?: (a: Uint8Array) => Uint8Array} | undefined} [c]
 * @returns {string}
 */
export function uuid(c = globalThis.crypto) {
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return uuidFromBytes(b);
}

/**
 * @param {unknown} s
 * @returns {boolean} true for a version 4 UUID string
 */
export function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}
