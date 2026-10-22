// @ts-check
/**
 * A small PDF writer with no dependencies, for the printable run report:
 * US Letter pages, the standard Helvetica fonts (nothing embedded), word
 * wrap, page breaks and "Page n of N" footers. Text is encoded as WinAnsi;
 * characters it lacks are spelled out ("Ω" -> "Ohm") or become "?".
 */

/**
 * @typedef {{kind: 'title' | 'h1' | 'h2' | 'p' | 'small', text: string}
 *   | {kind: 'kv', label: string, text: string}
 *   | {kind: 'rule'} | {kind: 'gap', pt: number} | {kind: 'break'}} PdfBlock
 */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 48;
const TOP = PAGE_H - 54;
const BOTTOM = 60;
const WIDTH = PAGE_W - 2 * MARGIN_X;
const KV_LABEL = 112;

/** Helvetica and Helvetica-Bold advance widths (1/1000 em) for codes 32-126. */
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260,
  334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280,
  389, 584];
/** Widths of the WinAnsi codes above 127 that reports use; others count as 556. */
const W_HIGH = /** @type {Record<number, number>} */ ({
  0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0xa0: 278,
  0xb0: 400, 0xb1: 584, 0xb2: 333, 0xb3: 333, 0xb5: 556, 0xb7: 278, 0xc5: 667, 0xd7: 584,
});

/** WinAnsi (cp1252) codes 128-159 by Unicode character. */
const CP1252 = /** @type {Record<string, number>} */ ({
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
});
/** Spelled-out stand-ins for characters WinAnsi lacks. */
const SPELL = /** @type {Record<string, string>} */ ({
  '−': '-', 'Ω': 'Ohm', 'μ': 'µ', 'Δ': 'delta ', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'θ': 'theta', 'λ': 'lambda',
  'σ': 'sigma', 'π': 'pi', 'ρ': 'rho', 'ε': 'epsilon', '≤': '<=', '≥': '>=', '→': '->', '←': '<-', '≈': '~', '∼': '~',
  '✓': 'v', ' ': ' ', ' ': ' ', '​': '',
});

/**
 * WinAnsi byte codes for a text.
 * @param {string} text
 * @returns {number[]}
 */
export function winAnsi(text) {
  /** @type {number[]} */
  const out = [];
  const one = (/** @type {string} */ ch) => {
    const c = ch.codePointAt(0) || 63;
    if (c === 9 || c === 10 || c === 13) out.push(32);
    else if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (CP1252[ch]) out.push(CP1252[ch]);
    else return false;
    return true;
  };
  // NFC first: the ohm sign becomes omega (spelled "Ohm"), and e plus an accent becomes é.
  for (const ch of String(text).normalize('NFC')) {
    if (one(ch)) continue;
    const alt = SPELL[ch] ?? ch.normalize('NFKC');
    if (alt === ch) { out.push(63); continue; }
    for (const a of alt) if (!one(a)) out.push(63);
  }
  return out;
}

/**
 * Width of a text in points.
 * @param {number[]} codes WinAnsi codes
 * @param {number} size font size
 * @param {boolean} bold
 * @returns {number}
 */
export function textWidth(codes, size, bold) {
  const table = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const c of codes) w += c >= 32 && c <= 126 ? table[c - 32] : W_HIGH[c] || 556;
  return (w * size) / 1000;
}

/**
 * Break a text into lines no wider than `max` points.
 * @param {string} text
 * @param {number} size
 * @param {boolean} bold
 * @param {number} max
 * @returns {number[][]} lines as WinAnsi codes
 */
export function wrap(text, size, bold, max) {
  /** @type {number[][]} */
  const lines = [];
  for (const para of String(text).split(/\r?\n/)) {
    /** @type {number[]} */
    let line = [];
    for (const word of para.split(/ +/).filter(Boolean).map(winAnsi)) {
      const candidate = line.length ? [...line, 32, ...word] : word;
      if (textWidth(candidate, size, bold) <= max) { line = candidate; continue; }
      if (line.length) lines.push(line);
      line = [];
      // A word wider than the line is cut where it must be.
      let rest = word;
      while (textWidth(rest, size, bold) > max) {
        // The longest start that fits (at least one character), in one pass.
        let n = 0;
        let w = 0;
        while (n < rest.length && (w += textWidth([rest[n]], size, bold)) <= max) n++;
        n = Math.max(n, 1);
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** @param {number[]} codes @returns {string} a PDF string literal */
const str = (codes) => `(${codes.map((c) => (c === 40 || c === 41 || c === 92 ? `\\${String.fromCharCode(c)}` : String.fromCharCode(c))).join('')})`;
/** @param {number} n */
const num = (n) => String(Math.round(n * 100) / 100);

/** Font, size, leading, space above and grey level of each text block. */
const STYLE = /** @type {Record<string, {bold: boolean, size: number, lead: number, above: number, gray: number}>} */ ({
  title: { bold: true, size: 18, lead: 22, above: 0, gray: 0 },
  h1: { bold: true, size: 14, lead: 18, above: 16, gray: 0 },
  h2: { bold: true, size: 10.5, lead: 14, above: 9, gray: 0 },
  p: { bold: false, size: 9.5, lead: 12.5, above: 0, gray: 0 },
  small: { bold: false, size: 8.5, lead: 11, above: 0, gray: 0.35 },
});

/**
 * A complete PDF file.
 * @param {PdfBlock[]} blocks
 * @param {{title?: string, footer?: string}} [o] document title, and the text left of the page number
 * @returns {Uint8Array}
 */
export function pdfBytes(blocks, o = {}) {
  /** @type {string[][]} */
  const pages = [[]];
  let y = TOP;
  const page = () => pages[pages.length - 1];
  const newPage = () => { pages.push([]); y = TOP; };
  const need = (/** @type {number} */ h) => { if (y - h < BOTTOM && page().length) newPage(); };
  const text = (/** @type {number[]} */ codes, /** @type {number} */ x, /** @type {any} */ s) => {
    page().push(`BT /${s.bold ? 'F2' : 'F1'} ${num(s.size)} Tf ${s.gray} g ${num(x)} ${num(y)} Td ${str(codes)} Tj ET`);
  };
  blocks.forEach((b, i) => {
    if (b.kind === 'break') { if (page().length) newPage(); return; }
    if (b.kind === 'gap') { y -= b.pt; return; }
    if (b.kind === 'rule') {
      need(8);
      y -= 4;
      page().push(`0.8 G 0.6 w ${MARGIN_X} ${num(y)} m ${MARGIN_X + WIDTH} ${num(y)} l S`);
      y -= 6;
      return;
    }
    if (b.kind === 'kv') {
      const s = STYLE.p;
      const label = winAnsi(b.label);
      const lw = textWidth(label, s.size, true);
      const lines = wrap(b.text, s.size, false, WIDTH - KV_LABEL);
      const own = lw > KV_LABEL - 6;
      need(s.lead * (lines.length + (own ? 1 : 0)));
      y -= s.lead;
      text(label, MARGIN_X, { ...s, bold: true });
      lines.forEach((l, j) => {
        if (j > 0 || own) { y -= s.lead; if (y < BOTTOM) { newPage(); y -= s.lead; } }
        text(l, MARGIN_X + KV_LABEL, s);
      });
      return;
    }
    const s = STYLE[b.kind] || STYLE.p;
    const lines = wrap(b.text, s.size, s.bold, WIDTH);
    // Keep a heading with the first lines that follow it.
    const next = blocks[i + 1];
    const keep = b.kind === 'h1' || b.kind === 'h2' ? (next ? 3 * STYLE.p.lead : 0) : 0;
    if (y < TOP) y -= s.above;
    need(s.lead * Math.min(lines.length, 3) + keep);
    for (const l of lines) {
      y -= s.lead;
      if (y < BOTTOM) { newPage(); y -= s.lead; }
      text(l, MARGIN_X, s);
    }
    if (b.kind === 'h1') { page().push(`0.75 G 0.8 w ${MARGIN_X} ${num(y - 5)} m ${MARGIN_X + WIDTH} ${num(y - 5)} l S`); y -= 7; }
    if (b.kind === 'title') y -= 4;
  });

  // Objects: 1 catalog, 2 page tree, 3 and 4 fonts, 5 info, then a page and its content per page.
  const n = pages.length;
  const footer = winAnsi(o.footer || '');
  /** @type {string[]} */
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${6 + 2 * i} 0 R`).join(' ')}] >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = `<< /Title ${str(winAnsi(o.title || 'Report'))} /Producer (LNF Run Log) >>`;
  pages.forEach((ops, i) => {
    const label = winAnsi(`Page ${i + 1} of ${n}`);
    const foot = [
      footer.length ? `BT /F1 8 Tf 0.4 g ${MARGIN_X} 30 Td ${str(footer)} Tj ET` : '',
      `BT /F1 8 Tf 0.4 g ${num(MARGIN_X + WIDTH - textWidth(label, 8, false))} 30 Td ${str(label)} Tj ET`,
    ].filter(Boolean);
    const content = [...ops, ...foot].join('\n');
    objects[6 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + 2 * i} 0 R >>`;
    objects[7 + 2 * i] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n%âãÏÓ\n';
  /** @type {number[]} */
  const offsets = [];
  for (let k = 1; k < objects.length; k++) {
    offsets[k] = out.length;
    out += `${k} 0 obj\n${objects[k]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let k = 1; k < objects.length; k++) out += `${String(offsets[k]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 0xff;
  return bytes;
}
