// @ts-check
// QR Code encoder (core/qr.js) and its SVG (ui/qr.js), checked against ISO/IEC
// 18004: version choice, function patterns, format and version information, and
// the Reed–Solomon blocks read back out of the matrix by a small reader built
// from the standard's tables rather than from the encoder's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, penaltyScore } from '../app/js/core/qr.js';
import { qrSvg, QUIET_ZONE } from '../app/js/ui/qr.js';

const URL37 = 'https://example.github.io/lnf-runlog/';
const UTF8 = 'SiO₂ résist 85 nm/min'; // 24 UTF-8 bytes
const LEVELS = /** @type {const} */ (['L', 'M', 'Q', 'H']);

/** @type {Record<number, number[]>} alignment-pattern centres (Annex E) for the versions used here */
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 6: [6, 34], 7: [6, 22, 38], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70],
  32: [6, 34, 60, 86, 112, 138], 36: [6, 24, 50, 76, 102, 128, 154], 40: [6, 30, 58, 86, 114, 142, 170],
};
/** @type {Record<number, number>} total codewords per version (Table 1) */
const TOTAL = { 1: 26, 3: 70, 7: 196, 15: 655, 40: 3706 };

/** @type {(x: number, y: number, n: number) => boolean} alignment centres covered by a finder */
const finderCorner = (x, y, n) => (x === 6 && (y === 6 || y === n - 7)) || (x === n - 7 && y === 6);

/** @type {(a: number, b: number) => number} product in GF(256) mod 0x11D, by shift-and-add */
function gfMul(a, b) {
  let p = 0;
  for (; b; b >>= 1, a = (a << 1) ^ (a & 0x80 ? 0x11d : 0)) if (b & 1) p ^= a;
  return p;
}

/** @type {(value: number, poly: number) => number} remainder of a GF(2) polynomial division */
function polyMod(value, poly) {
  const deg = 31 - Math.clz32(poly);
  for (let b = 31 - Math.clz32(value); b >= deg; b--) if ((value >> b) & 1) value ^= poly << (b - deg);
  return value;
}

/** Format-information positions [x, y] of bits 0–14, both copies (Figure 25). @param {number} n */
function formatPositions(n) {
  const first = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const second = [];
  for (let i = 0; i < 8; i++) second.push([n - 1 - i, 8]);
  for (let i = 8; i < 15; i++) second.push([8, n - 15 + i]);
  return [first, second];
}

/** Read both format copies, check them, and decode level and mask. @param {boolean[][]} m */
function readFormat(m) {
  const [a, b] = formatPositions(m.length).map((pos) => pos.reduce((acc, [x, y], i) => acc | (m[y][x] ? 1 << i : 0), 0));
  assert.equal(a, b, 'the two format copies agree');
  const raw = a ^ 0x5412;
  assert.equal(polyMod(raw, 0x537), 0, 'format information is a BCH(15,5) codeword');
  return { ecc: 'MLHQ'[raw >> 13], mask: (raw >> 10) & 7, bits: a };
}

/** Read both 18-bit version blocks and check them. @param {boolean[][]} m */
function readVersion(m) {
  const n = m.length;
  let a = 0;
  let b = 0;
  for (let i = 0; i < 18; i++) {
    const x = n - 11 + (i % 3);
    const y = Math.floor(i / 3);
    if (m[y][x]) a |= 1 << i; // top-right block, 3 wide
    if (m[x][y]) b |= 1 << i; // bottom-left block, 3 tall
  }
  assert.equal(a, b, 'the two version blocks agree');
  assert.equal(polyMod(a, 0x1f25), 0, 'version information is a BCH(18,6) codeword');
  return a;
}

/** Function modules of a version, from the layout in the standard. @param {number} v */
function functionMap(v) {
  const n = 4 * v + 17;
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  /** @type {(x0: number, y0: number, w: number, h: number) => void} */
  const mark = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) fn[y][x] = true;
  };
  mark(0, 0, 9, 9); // finders with separators, format information, dark module
  mark(n - 8, 0, 8, 9);
  mark(0, n - 8, 9, 8);
  mark(6, 0, 1, n); // timing patterns
  mark(0, 6, n, 1);
  for (const cy of ALIGN[v]) for (const cx of ALIGN[v]) if (!finderCorner(cx, cy, n)) mark(cx - 2, cy - 2, 5, 5);
  if (v >= 7) {
    mark(n - 11, 0, 3, 6); // version information
    mark(0, n - 11, 6, 3);
  }
  return fn;
}

/** @type {((i: number, j: number) => boolean)[]} data-mask conditions of Table 10 (i = row, j = column) */
const MASK = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/**
 * Unmask and read the symbol's codewords in placement order, then split them
 * into blocks of data and error-correction codewords.
 * @param {{version: number, modules: boolean[][]}} q
 * @param {number} numBlocks
 * @param {number} eccLen
 */
function readBlocks(q, numBlocks, eccLen) {
  const m = q.modules;
  const n = m.length;
  const fn = functionMap(q.version);
  const { mask } = readFormat(m);
  const bits = [];
  let upward = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let k = 0; k < n; k++) {
      const i = upward ? n - 1 - k : k;
      for (const j of [right, right - 1]) if (!fn[i][j]) bits.push(m[i][j] !== MASK[mask](i, j) ? 1 : 0);
    }
    upward = !upward;
  }
  const total = Math.floor(bits.length / 8);
  assert.ok(bits.slice(total * 8).every((b) => b === 0), 'remainder bits are light before masking');
  const words = Array.from({ length: total }, (_, i) => parseInt(bits.slice(8 * i, 8 * i + 8).join(''), 2));
  const numLong = total % numBlocks; // the last blocks hold one more data codeword
  const shortData = Math.floor(total / numBlocks) - eccLen;
  const blocks = Array.from({ length: numBlocks }, (_, b) => ({
    len: shortData + (b >= numBlocks - numLong ? 1 : 0), data: /** @type {number[]} */ ([]), ecc: /** @type {number[]} */ ([]),
  }));
  let k = 0;
  for (let i = 0; i <= shortData; i++) for (const b of blocks) if (i < b.len) b.data.push(words[k++]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) b.ecc.push(words[k++]);
  return { total, blocks };
}

/** Syndromes S_j = c(α^j), j < eccLen: all zero for a valid block. @param {{data: number[], ecc: number[]}} b */
function syndromes(b) {
  const word = [...b.data, ...b.ecc];
  const out = [];
  for (let j = 0, aj = 1; j < b.ecc.length; j++, aj = gfMul(aj, 2)) out.push(word.reduce((s, c) => gfMul(s, aj) ^ c, 0));
  return out;
}

/** Parse byte-mode data codewords and check the terminator and padding. @param {number[]} data @param {number} version */
function parsePayload(data, version) {
  const stream = data.flatMap((c) => c.toString(2).padStart(8, '0').split('').map(Number));
  let p = 0;
  const take = (/** @type {number} */ n) => parseInt(stream.slice(p, (p += n)).join(''), 2);
  assert.equal(take(4), 0b0100, 'byte mode');
  const count = take(version < 10 ? 8 : 16);
  const bytes = Uint8Array.from({ length: count }, () => take(8));
  const padFrom = Math.ceil(Math.min(stream.length, p + 4) / 8);
  assert.ok(stream.slice(p, padFrom * 8).every((b) => b === 0), 'terminator and bit padding are zeros');
  data.slice(padFrom).forEach((c, i) => assert.equal(c, i % 2 ? 0x11 : 0xec, 'pad codewords alternate 0xEC 0x11'));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** @type {[string, any, number, number, number][]} [text, options, version, blocks, EC codewords per block] per Table 9 */
const BLOCK_CASES = [
  ['x'.repeat(17), { ecc: 'L' }, 1, 1, 7],
  ['0123456789', { ecc: 'Q' }, 1, 1, 13],
  [URL37, { ecc: 'M' }, 3, 1, 26],
  [UTF8, { ecc: 'H' }, 3, 2, 22],
  [URL37, { ecc: 'Q', minVersion: 7 }, 7, 6, 18],
  ['y'.repeat(400), { ecc: 'M' }, 15, 10, 24],
  ['LNF Run Log', { ecc: 'H', minVersion: 40 }, 40, 81, 30],
];

test('picks the smallest version that holds the UTF-8 bytes', () => {
  assert.equal(encodeQr('x'.repeat(17), { ecc: 'L' }).version, 1);
  assert.equal(encodeQr('x'.repeat(18), { ecc: 'L' }).version, 2);
  const url40 = 'https://example.github.io/lnf-runlog/v1/';
  assert.equal(url40.length, 40);
  const q = encodeQr(url40);
  assert.equal(q.ecc, 'M');
  assert.equal(q.version, 3);
  assert.equal(encodeQr(UTF8, { ecc: 'H' }).version, 3); // exactly v3-H's 24 bytes
  assert.equal(encodeQr(`${UTF8}x`, { ecc: 'H' }).version, 4);
  assert.equal(encodeQr('x'.repeat(600)).version, 19);
  assert.equal(encodeQr('x'.repeat(2953), { ecc: 'L' }).version, 40);
  assert.equal(encodeQr('', { ecc: 'H' }).version, 1);
  assert.equal(encodeQr('x', { minVersion: 7 }).version, 7);
});

test('size is 4 × version + 17, square, with no quiet zone', () => {
  for (const v of [1, 2, 7, 14, 21, 32, 40]) {
    const q = encodeQr('size', { minVersion: v });
    assert.equal(q.version, v);
    assert.equal(q.size, 4 * v + 17);
    assert.equal(q.modules.length, q.size);
    for (const row of q.modules) assert.equal(row.length, q.size);
    assert.ok(q.modules.flat().every((c) => typeof c === 'boolean'));
    assert.equal(q.modules[0][0], true, 'the finder starts at the edge');
  }
});

test('finder patterns with separators in three corners, and the dark module', () => {
  for (const q of [encodeQr(URL37), encodeQr('x', { ecc: 'L' }), encodeQr('x'.repeat(300), { ecc: 'Q' })]) {
    const { modules: m, size: n } = q;
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const x = ox + dx;
          const y = oy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          assert.equal(m[y][x], d !== 2 && d !== 4, `finder module (${x}, ${y}) of v${q.version}`);
        }
      }
    }
    assert.equal(m[n - 8][8], true, 'dark module at row 4V + 9, column 8');
  }
});

test('timing patterns alternate along row 6 and column 6', () => {
  for (const v of [1, 7, 40]) {
    const { modules: m, size: n } = encodeQr('timing', { minVersion: v });
    for (let i = 8; i < n - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0, `row 6, column ${i}`);
      assert.equal(m[i][6], i % 2 === 0, `column 6, row ${i}`);
    }
  }
});

test('alignment patterns sit at the Annex E centres', () => {
  for (const [v, pos] of Object.entries(ALIGN)) {
    const { modules: m, size: n } = encodeQr('align', { minVersion: Number(v) });
    for (const cy of pos) {
      for (const cx of pos) {
        if (finderCorner(cx, cy, n)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            assert.equal(m[cy + dy][cx + dx], Math.max(Math.abs(dx), Math.abs(dy)) !== 1, `v${v} alignment at (${cx}, ${cy})`);
          }
        }
      }
    }
  }
});

test('format information decodes to the level and mask used', () => {
  for (const ecc of LEVELS) {
    for (let mask = 0; mask < 8; mask++) {
      const q = encodeQr(URL37, { ecc, mask });
      assert.equal(q.mask, mask);
      const f = readFormat(q.modules);
      assert.deepEqual([f.ecc, f.mask], [ecc, mask]);
    }
    const auto = encodeQr(URL37, { ecc });
    assert.equal(readFormat(auto.modules).mask, auto.mask);
  }
  // Annex C worked example: level M, mask 101 -> 100000011001110.
  assert.equal(readFormat(encodeQr(URL37, { ecc: 'M', mask: 5 }).modules).bits, 0b100000011001110);
});

test('version information from version 7 up', () => {
  assert.equal(readVersion(encodeQr('v', { minVersion: 7 }).modules), 0x07c94); // Annex D
  assert.equal(readVersion(encodeQr('v', { minVersion: 40 }).modules), 0x28c69);
  for (let v = 7; v <= 40; v++) assert.equal(readVersion(encodeQr('v', { minVersion: v }).modules) >> 12, v);
});

test('Reed–Solomon: every block read back from the matrix has zero syndromes', () => {
  for (const [text, opts, version, numBlocks, eccLen] of BLOCK_CASES) {
    const q = encodeQr(text, opts);
    assert.equal(q.version, version);
    const { total, blocks } = readBlocks(q, numBlocks, eccLen);
    assert.equal(total, TOTAL[version], `v${version} codeword count`);
    for (const b of blocks) assert.ok(syndromes(b).every((s) => s === 0), `v${version}-${q.ecc}: nonzero syndrome`);
    assert.equal(parsePayload(blocks.flatMap((b) => b.data), version), text);
  }
});

test('a flipped data module shows in the syndromes', () => {
  const q = encodeQr(URL37);
  q.modules[q.size - 1][q.size - 1] = !q.modules[q.size - 1][q.size - 1]; // the first data bit
  assert.ok(syndromes(readBlocks(q, 1, 26).blocks[0]).some((s) => s !== 0));
});

test('penaltyScore applies rules N1–N4', () => {
  const grid = (/** @type {string[]} */ rows) => rows.map((r) => [...r].map((c) => c === '#'));
  assert.equal(penaltyScore(grid(['#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#'])), 0);
  assert.equal(penaltyScore(grid(Array(6).fill('......'))), 12 * 4 + 25 * 3 + 100); // N1, N2, N4
  assert.equal(penaltyScore(grid(['#######'])), 5 + 100); // N1 for a run of 7, N4 all dark
  assert.equal(penaltyScore(grid(['#.###.#'])), 40 + 40); // N3 (quiet zone is light), N4 5/7 dark
  assert.equal(penaltyScore(grid(['#...#.###.#...#'])), 0); // only 3 light modules on each side
  assert.equal(penaltyScore(grid(['#....#.###.#...#'])), 40 + 10); // 4 light before it
});

test('the chosen mask has the lowest penalty of the eight', () => {
  for (const [text, ecc] of /** @type {[string, 'L' | 'M' | 'Q' | 'H'][]} */ ([[URL37, 'M'], [UTF8, 'H'], ['x'.repeat(300), 'L'], ['0123456789', 'Q']])) {
    const auto = encodeQr(text, { ecc });
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => penaltyScore(encodeQr(text, { ecc, mask }).modules));
    assert.equal(auto.mask, scores.indexOf(Math.min(...scores)));
    assert.deepEqual(auto.modules, encodeQr(text, { ecc, mask: auto.mask }).modules);
  }
});

test('throws RangeError when the data does not fit, or on bad options', () => {
  assert.throws(() => encodeQr('x'.repeat(2954), { ecc: 'L' }), RangeError);
  assert.throws(() => encodeQr('x'.repeat(1274), { ecc: 'H' }), RangeError);
  assert.equal(encodeQr('x'.repeat(1273), { ecc: 'H' }).version, 40);
  assert.throws(() => encodeQr('é'.repeat(1477), { ecc: 'L' }), RangeError); // 2954 UTF-8 bytes
  assert.throws(() => encodeQr('x'.repeat(18), { ecc: 'L', maxVersion: 1 }), RangeError);
  assert.throws(() => encodeQr('x', { ecc: /** @type {any} */ ('X') }), RangeError);
  assert.throws(() => encodeQr('x', { minVersion: 0 }), RangeError);
  assert.throws(() => encodeQr('x', { minVersion: 5, maxVersion: 4 }), RangeError);
  assert.throws(() => encodeQr('x', { mask: 8 }), RangeError);
  assert.throws(() => encodeQr(/** @type {any} */ (42)), TypeError);
});

test('encoding is deterministic; the decoder-verified symbol is pinned', () => {
  for (const text of [URL37, UTF8, 'x'.repeat(600)]) assert.deepEqual(encodeQr(text), encodeQr(text));
  // URL37 at M, read back exactly by OpenCV 5.0 and ZXing-C++ 3.1 (2026-10-20); one hex word per row.
  const golden = [
    '1fdc557f 10521b41 1750c45d 174a595d 1757d65d 1044cd41 1fd5557f 00027200 13fddb97 0a106eb6',
    '11576194 13884849 12dfd561 172d3c7f 16dd7a35 040ae055 16c90028 15052716 1e6bea79 1b2d978c',
    '1f60a9fe 001dad18 1fd6a358 1056bf13 1754a3f9 175ff421 174ca8b7 104f44bd 1fdd87d0',
  ].join(' ');
  const q = encodeQr(URL37);
  assert.deepEqual([q.version, q.ecc, q.mask], [3, 'M', 6]);
  assert.equal(q.modules.map((r) => parseInt(r.map(Number).join(''), 2).toString(16).padStart(8, '0')).join(' '), golden);
});

test('qrSvg draws one black path on white with a 4-module quiet zone', () => {
  class FakeNode {}
  class FakeElement extends FakeNode {
    /** @param {string} tag */
    constructor(tag) {
      super();
      this.tag = tag;
      /** @type {Record<string, string>} */
      this.attrs = {};
      /** @type {any[]} */
      this.children = [];
    }
    /** @param {string} k @param {string} v */
    setAttribute(k, v) { this.attrs[k] = v; }
    /** @param {...any} c */
    append(...c) { this.children.push(...c); }
  }
  const g = /** @type {any} */ (globalThis);
  g.Node = FakeNode;
  g.document = { createElementNS: (/** @type {string} */ _ns, /** @type {string} */ tag) => new FakeElement(tag) };
  try {
    const el = /** @type {any} */ (qrSvg(URL37, { label: 'Open LNF Run Log' }));
    const q = encodeQr(URL37);
    const n = q.size + 2 * QUIET_ZONE;
    assert.equal(QUIET_ZONE, 4);
    assert.deepEqual(
      [el.tag, el.attrs.width, el.attrs.height, el.attrs.viewBox, el.attrs['shape-rendering'], el.attrs.role, el.attrs['aria-label']],
      ['svg', '240', '240', `0 0 ${n} ${n}`, 'crispEdges', 'img', 'Open LNF Run Log'],
    );
    assert.deepEqual(el.children.map((/** @type {any} */ c) => [c.tag, c.attrs.fill]), [['rect', '#fff'], ['path', '#000']]);
    assert.deepEqual([el.children[0].attrs.width, el.children[0].attrs.height], [String(n), String(n)]);
    // Paint the path back: it must be exactly the symbol, shifted by the quiet zone.
    const d = el.children[1].attrs.d;
    const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
    assert.equal(d.replace(re, ''), '', 'the path is only module rectangles');
    const painted = Array.from({ length: n }, () => new Array(n).fill(false));
    for (const [, x, y, w, back] of d.matchAll(re)) {
      assert.equal(w, back);
      for (let k = 0; k < Number(w); k++) painted[Number(y)][Number(x) + k] = true;
    }
    const want = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => q.modules[y - 4]?.[x - 4] === true));
    assert.deepEqual(painted, want);
    const small = /** @type {any} */ (qrSvg(URL37, { size: 120, ecc: 'H' }));
    const nh = encodeQr(URL37, { ecc: 'H' }).size + 8;
    assert.deepEqual([small.attrs.width, small.attrs.viewBox, small.attrs['aria-label']], ['120', `0 0 ${nh} ${nh}`, URL37]);
  } finally {
    delete g.Node;
    delete g.document;
  }
});
