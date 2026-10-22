// @ts-check
/**
 * QR Code encoder after ISO/IEC 18004 (Model 2), byte mode with UTF-8. Pure: no DOM, no
 * imports. encodeQr() picks the smallest version that fits, adds Reed–Solomon codewords to
 * each block, interleaves the blocks, draws the function patterns and the zigzag data, and
 * keeps the data mask with the lowest penalty. Matrices are modules[y][x] (row, column),
 * true = dark, with no quiet zone: renderers add 4 light modules on every side.
 */

/** @typedef {'L' | 'M' | 'Q' | 'H'} Ecc */

/**
 * @typedef {object} QrCode
 * @property {number} version 1–40
 * @property {number} size modules per side, 4 × version + 17
 * @property {Ecc} ecc error-correction level: L, M, Q, H recover about 7, 15, 25, 30 % damage
 * @property {number} mask data mask 0–7
 * @property {boolean[][]} modules modules[y][x], true = dark, no quiet zone
 */

/** @typedef {{m: boolean[][], fn: boolean[][]}} Grid the modules, and which of them are function modules */

/** The levels in the order of their 2-bit code in the format information: M 00, L 01, H 10, Q 11. */
const LEVELS = ['M', 'L', 'H', 'Q'];

// ISO/IEC 18004 Table 9 by [level][version] (index 0 unused): error-correction
// codewords per block, and the number of blocks. The rest of the capacity is data.
/** @type {Record<Ecc, number[]>} */
const ECC_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
    28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
    30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
/** @type {Record<Ecc, number[]>} */
const NUM_BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
    23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
    25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

// GF(256) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11D), with exp/log tables for α = 2.
const EXP = new Uint8Array(510);
const LOG = new Uint8Array(256);
for (let i = 0, v = 1; i < 255; i++) {
  EXP[i] = EXP[i + 255] = v;
  LOG[v] = i;
  v = (v << 1) ^ (v & 0x80 ? 0x11d : 0);
}
/** @type {(a: number, b: number) => number} product in GF(256) */
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/**
 * Reed–Solomon generator (x − α^0)(x − α^1)…(x − α^(n−1)): n + 1 coefficients, highest power first.
 * @param {number} n @returns {number[]}
 */
function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = [...g, 0]; // g · x
    for (let j = 0; j < g.length; j++) next[j + 1] ^= mul(g[j], EXP[i]); // + g · α^i (minus is plus)
    g = next;
  }
  return g;
}

/**
 * A block's error-correction codewords: data(x) · x^n modulo the generator, by long division.
 * @param {number[]} data @param {number[]} gen from rsGenerator(n) @returns {number[]}
 */
function rsRemainder(data, gen) {
  const rem = new Array(gen.length - 1).fill(0);
  for (const byte of data) {
    const factor = byte ^ /** @type {number} */ (rem.shift());
    rem.push(0);
    for (let i = 0; i < rem.length; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

/**
 * BCH check bits: the remainder of value · x^n divided by poly, over GF(2).
 * @param {number} value @param {number} poly of degree n, as bits @param {number} n @returns {number}
 */
function bchBits(value, poly, n) {
  let rem = value << n;
  for (let bit = 31 - Math.clz32(rem); bit >= n; bit--) if ((rem >> bit) & 1) rem ^= poly << (bit - n);
  return rem;
}

/**
 * Alignment-pattern centres on either axis (Annex E): 6, then evenly spaced back from size − 7.
 * @param {number} ver @returns {number[]}
 */
function alignmentCentres(ver) {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const size = 4 * ver + 17;
  const step = ver === 32 ? 26 : 2 * Math.ceil((size - 13) / (2 * (count - 1))); // even; v32 is the exception
  const pos = [6];
  for (let p = size - 7; pos.length < count; p -= step) pos.splice(1, 0, p);
  return pos;
}

/**
 * Modules left for data and error correction after the function patterns and format/version information.
 * @param {number} ver @returns {number}
 */
function dataModules(ver) {
  const size = 4 * ver + 17;
  const n = alignmentCentres(ver).length;
  const align = n ? n * n - 3 : 0;
  return size * size - 3 * 64 // finders with their separators
    - 2 * (size - 16) - 31 // timing patterns; format information twice, and the dark module
    - (25 * align - 10 * Math.max(0, n - 2)) // alignment patterns, less their overlap with the timing
    - (ver >= 7 ? 36 : 0); // version information twice
}

/** @type {(ver: number, ecc: Ecc) => number} data codewords of a version at a level */
const dataCodewords = (ver, ecc) => (dataModules(ver) >> 3) - ECC_PER_BLOCK[ecc][ver] * NUM_BLOCKS[ecc][ver];

/**
 * Split the data codewords into the version's blocks (the first ones a codeword shorter when
 * they do not divide evenly), add each block's Reed–Solomon codewords, and interleave:
 * codeword 0 of every block, then codeword 1, and so on; data first, then error correction.
 * @param {number[]} data @param {number} ver @param {Ecc} ecc @returns {number[]}
 */
function interleave(data, ver, ecc) {
  const numBlocks = NUM_BLOCKS[ecc][ver];
  const eccLen = ECC_PER_BLOCK[ecc][ver];
  const total = dataModules(ver) >> 3;
  const numLong = total % numBlocks;
  const shortLen = Math.floor(total / numBlocks) - eccLen;
  const gen = rsGenerator(eccLen);
  const blocks = [];
  for (let b = 0, start = 0; b < numBlocks; b++) {
    const len = shortLen + (b >= numBlocks - numLong ? 1 : 0);
    const part = data.slice(start, start + len);
    start += len;
    blocks.push({ part, check: rsRemainder(part, gen) });
  }
  const out = [];
  for (let i = 0; i <= shortLen; i++) for (const b of blocks) if (i < b.part.length) out.push(b.part[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.check[i]);
  return out;
}

/** @type {(size: number) => boolean[][]} a size × size matrix of false */
const matrix = (size) => Array.from({ length: size }, () => new Array(size).fill(false));

/** @type {(g: Grid, x: number, y: number, dark: boolean) => void} draw one function module */
const setFn = (g, x, y, dark) => {
  g.m[y][x] = dark;
  g.fn[y][x] = true;
};

/**
 * Draw the 15-bit format information (2-bit level, 3-bit mask, BCH(15,5)
 * check bits, XOR 0x5412) in both copies, and the dark module.
 * @param {Grid} g @param {number} level @param {number} mask
 */
function drawFormat(g, level, mask) {
  const size = g.m.length;
  const data = (level << 3) | mask;
  const bits = ((data << 10) | bchBits(data, 0x537, 10)) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;
    // Copy 1 by the top-left finder: bits 0–7 down column 8, bits 8–14 leftwards
    // along row 8, stepping over the timing patterns in row and column 6.
    if (i < 8) setFn(g, 8, i < 6 ? i : i + 1, dark);
    else setFn(g, i === 8 ? 7 : 14 - i, 8, dark);
    // Copy 2: bits 0–7 leftwards from the right edge along row 8, under the
    // top-right finder; bits 8–14 down column 8, beside the bottom-left one.
    if (i < 8) setFn(g, size - 1 - i, 8, dark);
    else setFn(g, 8, size - 15 + i, dark);
  }
  setFn(g, 8, size - 8, true); // the dark module
}

/**
 * Draw the finder, separator, timing and alignment patterns and the version
 * information, and reserve the format area.
 * @param {Grid} g @param {number} ver @param {number} level
 */
function drawFunctionPatterns(g, ver, level) {
  const size = g.m.length;
  // Finders in three corners, ringed by a light separator (clipped at the
  // edge): by Chebyshev distance from the centre, 0–1 and 3 are dark.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let y = Math.max(0, cy - 4); y <= Math.min(size - 1, cy + 4); y++) {
      for (let x = Math.max(0, cx - 4); x <= Math.min(size - 1, cx + 4); x++) {
        setFn(g, x, y, ![2, 4].includes(Math.max(Math.abs(x - cx), Math.abs(y - cy))));
      }
    }
  }
  // Timing patterns along row 6 and column 6, between the separators.
  for (let i = 8; i < size - 8; i++) {
    setFn(g, i, 6, i % 2 === 0);
    setFn(g, 6, i, i % 2 === 0);
  }
  // 5 × 5 alignment patterns at each pair of centres except the three finder
  // corners. Where one crosses a timing pattern the two agree: centres are even.
  const pos = alignmentCentres(ver);
  const far = pos[pos.length - 1];
  for (const cy of pos) {
    for (const cx of pos) {
      if ((cx === 6 && (cy === 6 || cy === far)) || (cx === far && cy === 6)) continue;
      for (let y = cy - 2; y <= cy + 2; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) setFn(g, x, y, Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== 1);
      }
    }
  }
  drawFormat(g, level, 0); // reserves the area; redrawn once the mask is chosen
  // Version information from version 7: 6 bits and BCH(18,6) check bits in a
  // block 3 wide left of the top-right finder, transposed above the bottom-left.
  if (ver >= 7) {
    const bits = (ver << 12) | bchBits(ver, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1;
      setFn(g, size - 11 + (i % 3), Math.floor(i / 3), dark);
      setFn(g, Math.floor(i / 3), size - 11 + (i % 3), dark);
    }
  }
}

/**
 * Lay the codeword bits, most significant first, in zigzag order: two-column
 * strips from the right edge, alternately up and down, skipping column 6 and
 * every function module. Leftover remainder modules stay light.
 * @param {Grid} g @param {number[]} codewords
 */
function placeData(g, codewords) {
  const size = g.m.length;
  let bit = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern
    for (let k = 0; k < size; k++) {
      const y = upward ? size - 1 - k : k;
      for (const x of [right, right - 1]) {
        if (g.fn[y][x] || bit >= codewords.length * 8) continue;
        g.m[y][x] = ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
    upward = !upward;
  }
}

/**
 * The eight data-mask conditions (x = column, y = row); where one holds, a data module is inverted.
 * @type {((x: number, y: number) => boolean)[]}
 */
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * Invert the data modules the mask selects; applying it twice restores them.
 * @param {Grid} g @param {number} mask
 */
function applyMask(g, mask) {
  const cond = MASKS[mask];
  g.m.forEach((row, y) => row.forEach((dark, x) => {
    if (!g.fn[y][x] && cond(x, y)) row[x] = !dark;
  }));
}

/**
 * Rules N1 and N3 for one row or column.
 * @param {boolean[]} line @returns {number}
 */
function lineScore(line) {
  const runs = [0]; // alternating run lengths, light first: odd indices are dark runs
  for (const dark of line) {
    if (dark === (runs.length % 2 === 0)) runs[runs.length - 1]++;
    else runs.push(1);
  }
  let score = 0;
  for (const k of runs) if (k >= 5) score += k - 2; // N1: 3 + (k − 5)
  // N3 sees the quiet zone beyond both ends as light.
  runs[0] = Infinity;
  if (runs.length % 2) runs[runs.length - 1] = Infinity;
  else runs.push(Infinity);
  for (let i = 1; i + 5 < runs.length; i += 2) {
    const u = runs[i];
    if (runs[i + 1] === u && runs[i + 2] === 3 * u && runs[i + 3] === u && runs[i + 4] === u
      && (runs[i - 1] >= 4 * u || runs[i + 5] >= 4 * u)) score += 40;
  }
  return score;
}

/**
 * Penalty score of a symbol under the four rules of ISO/IEC 18004 (lower is
 * better); the encoder keeps the mask that scores lowest.
 *   N1: 3 + (k − 5) for each run of k ≥ 5 same-colour modules in a row or column.
 *   N2: 3 for each 2 × 2 block of one colour (overlapping blocks all count).
 *   N3: 40 for each dark-light-dark-light-dark run in the ratio 1:1:3:1:1, in
 *       a row or column, with a light run 4 units long before or after it.
 *   N4: 10 for each full 5 % by which the dark share differs from 50 %.
 * @param {boolean[][]} m any rectangular matrix
 * @returns {number}
 */
export function penaltyScore(m) {
  const rows = m.length;
  const cols = rows ? m[0].length : 0;
  if (!rows || !cols) return 0;
  let score = 0;
  for (const row of m) score += lineScore(row);
  for (let x = 0; x < cols; x++) score += lineScore(m.map((row) => row[x]));
  let dark = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = m[y][x];
      if (c) dark++;
      if (y + 1 < rows && x + 1 < cols && m[y][x + 1] === c && m[y + 1][x] === c && m[y + 1][x + 1] === c) score += 3;
    }
  }
  const total = rows * cols;
  return score + 10 * Math.floor(Math.abs(20 * dark - 10 * total) / total);
}

/**
 * Encode text as a QR Code symbol in byte mode (UTF-8, no ECI header, as
 * phone cameras expect).
 * @param {string} text
 * @param {{ecc?: Ecc, minVersion?: number, maxVersion?: number, mask?: number}} [opts]
 *   mask forces one data mask (0–7) instead of the lowest-penalty one
 * @returns {QrCode}
 * @throws {RangeError} when the text does not fit in maxVersion, or an option is out of range
 */
export function encodeQr(text, { ecc = 'M', minVersion = 1, maxVersion = 40, mask } = {}) {
  if (typeof text !== 'string') throw new TypeError('encodeQr needs a string');
  const level = LEVELS.indexOf(ecc);
  if (level < 0) throw new RangeError(`QR error-correction level must be L, M, Q or H, not ${ecc}`);
  if (!Number.isInteger(minVersion) || !Number.isInteger(maxVersion) || minVersion < 1 || maxVersion > 40
    || minVersion > maxVersion) throw new RangeError('QR versions need 1 ≤ minVersion ≤ maxVersion ≤ 40');
  if (mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) throw new RangeError('QR mask must be 0–7');
  const bytes = new TextEncoder().encode(text);

  // The smallest version whose capacity holds the mode, the count and the bytes.
  let version = minVersion;
  while (4 + (version < 10 ? 8 : 16) + 8 * bytes.length > 8 * dataCodewords(version, ecc)) {
    if (++version > maxVersion) throw new RangeError(`Too much for a QR code: ${bytes.length} bytes at level ${ecc}`);
  }

  // Bit stream: mode, count, data, terminator, zero bits to a byte boundary,
  // then the pad codewords 0xEC and 0x11 in turn up to the capacity.
  const bits = /** @type {number[]} */ ([]);
  /** @type {(value: number, n: number) => void} */
  const put = (value, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = 8 * dataCodewords(version, ecc);
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));

  const size = 4 * version + 17;
  const g = { m: matrix(size), fn: matrix(size) };
  drawFunctionPatterns(g, version, level);
  placeData(g, interleave(data, version, ecc));

  // Try every mask with its own format information; keep the lowest score.
  let chosen = mask ?? -1;
  if (chosen < 0) {
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      applyMask(g, k);
      drawFormat(g, level, k);
      const score = penaltyScore(g.m);
      if (score < best) [best, chosen] = [score, k];
      applyMask(g, k); // undo
    }
  }
  applyMask(g, chosen);
  drawFormat(g, level, chosen);
  return { version, size, ecc, mask: chosen, modules: g.m };
}
