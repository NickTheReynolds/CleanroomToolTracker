// @ts-check
// The export of everything: the zip and Excel writers, the PDF writer, and
// what the CSV table, the workbook and the report contain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipStore, xlsxBytes, columnName, excelDate, sheetNames, xmlText } from '../app/js/core/xlsx.js';
import { pdfBytes, winAnsi, wrap, textWidth } from '../app/js/core/pdf.js';
import { allRunsTable, allRunsCsv, allSheets, reportBlocks, measurementText, localStamp } from '../app/js/core/export-all.js';
import { tool, template, runA, runB, derivedRun, measurement, cleanEvent } from './fixtures.mjs';

const dec = new TextDecoder();

/**
 * The entries of a stored zip, read through its central directory.
 * @param {Uint8Array} zip
 * @returns {Map<string, Uint8Array>}
 */
function unzip(zip) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50, 'end of central directory');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  /** @type {Map<string, Uint8Array>} */
  const out = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(at, true), 0x02014b50, 'central directory entry');
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = dec.decode(zip.subarray(at + 46, at + 46 + nameLen));
    assert.equal(v.getUint32(local, true), 0x04034b50, `local header of ${name}`);
    const start = local + 30 + v.getUint16(local + 26, true);
    const data = zip.subarray(start, start + size);
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    out.set(name, data);
    at += 46 + nameLen;
  }
  return out;
}

test('crc32 and a stored zip that its own central directory describes', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const files = unzip(zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'dir/b.xml', data: new Uint8Array([1, 2, 3]) }]));
  assert.deepEqual([...files.keys()], ['a.txt', 'dir/b.xml']);
  assert.equal(dec.decode(files.get('a.txt')), 'hello');
});

test('xlsx helpers: column names, Excel dates, sheet names, XML text', () => {
  assert.deepEqual([0, 25, 26, 701, 702].map(columnName), ['A', 'Z', 'AA', 'ZZ', 'AAA']);
  assert.equal(excelDate(new Date(2026, 0, 1, 12, 0).getTime()), 46023.5);
  assert.deepEqual(sheetNames(['Runs', 'runs', 'a/b:c?', 'x'.repeat(40)]), ['Runs', 'runs (2)', 'a b c', 'x'.repeat(31)]);
  assert.equal(xmlText('<a & "b">\u0001'), '&lt;a &amp; &quot;b&quot;&gt;');
});

test('xlsxBytes: a workbook with typed cells, a bold frozen header and filters', () => {
  const files = unzip(xlsxBytes([
    { name: 'Data', rows: [['name', 'n', 'ok', 'when'], ['Si <100>', 3.5, true, { date: new Date(2026, 0, 1).getTime() }], [null, undefined, '', NaN]] },
    { name: 'Data', rows: [['only header']] },
  ]));
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) assert.ok(files.has(name), name);
  const wb = dec.decode(files.get('xl/workbook.xml'));
  assert.match(wb, /<sheet name="Data" sheetId="1" r:id="rId1"\/><sheet name="Data \(2\)" sheetId="2" r:id="rId2"\/>/);
  const s1 = dec.decode(files.get('xl/worksheets/sheet1.xml'));
  assert.match(s1, /<c r="A1" t="inlineStr" s="1"><is><t>name<\/t><\/is><\/c>/);
  assert.match(s1, /<c r="A2" t="inlineStr"><is><t>Si &lt;100&gt;<\/t><\/is><\/c>/);
  assert.match(s1, /<c r="B2"><v>3.5<\/v><\/c><c r="C2" t="b"><v>1<\/v><\/c><c r="D2" s="2"><v>46023<\/v><\/c>/);
  assert.match(s1, /<row r="3"><\/row>/, 'empty values make no cells');
  assert.match(s1, /<pane ySplit="1"[^>]*state="frozen"\/>/);
  assert.match(s1, /<autoFilter ref="A1:D3"\/>/);
  assert.ok(!dec.decode(files.get('xl/worksheets/sheet2.xml')).includes('autoFilter'), 'no filter on a header-only sheet');
  assert.match(dec.decode(files.get('[Content_Types].xml')), /\/xl\/worksheets\/sheet2\.xml/);
});

test('winAnsi, widths and wrapping', () => {
  assert.deepEqual(winAnsi('µ°Å–—’²'), [0xb5, 0xb0, 0xc5, 0x96, 0x97, 0x92, 0xb2]);
  assert.deepEqual(winAnsi('Ω−≤'), [...'Ohm-<='].map((c) => c.charCodeAt(0)));
  assert.deepEqual(winAnsi('SiO₂ 中'), [...'SiO2 ?'].map((c) => c.charCodeAt(0)));
  assert.equal(textWidth(winAnsi('ii'), 10, false), 4.44);
  const lines = wrap('one two three four five six seven eight nine ten', 10, false, 60);
  assert.ok(lines.length > 2);
  for (const l of lines) assert.ok(textWidth(l, 10, false) <= 60);
  assert.equal(wrap('', 10, false, 100).length, 1, 'an empty text is one empty line');
  assert.ok(wrap('x'.repeat(200), 10, false, 50).length >= 4, 'a long word is cut');
});

test('pdfBytes: a well-formed file whose cross-references point at their objects, with page breaks and footers', () => {
  const blocks = [{ kind: 'title', text: 'Report (draft) \\ test' }, ...Array.from({ length: 120 }, (_, i) => /** @type {const} */ ({
    kind: 'kv', label: `Row ${i}`, text: 'Some text that is long enough to wrap onto a second line in the value column of the report, µm and °C.',
  }))];
  const bytes = pdfBytes(/** @type {any} */ (blocks), { title: 'T', footer: 'LNF Run Log' });
  const text = String.fromCharCode(...bytes);
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));
  const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
  assert.ok(text.slice(xref).startsWith('xref\n'));
  const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj\n`), `object ${i + 1}`));
  const count = Number(/\/Count (\d+)/.exec(text)?.[1]);
  assert.ok(count >= 3, `${count} pages`);
  assert.ok(text.includes(`(Page ${count} of ${count}) Tj`));
  assert.ok(text.includes('(Report \\(draft\\) \\\\ test) Tj'), 'parentheses and backslashes are escaped');
  for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = /** @type {number} */ (m.index) + m[0].length;
    assert.equal(text.slice(start + Number(m[1]), start + Number(m[1]) + 10), '\nendstream', 'stream lengths are exact');
  }
});

const deleted = { ...runA, id: 'X', deleted: true };
const pre = measurement('m1', 'pre', [1000, 1002, 998, 1001, 999]);
const post = measurement('m2', 'post', [575, 577, 573, 576, 574]);
const input = {
  tools: [tool, { ...tool, id: 'ellipsometer', name: 'Woollam', shortName: 'Woollam', category: 'metrology', kind: 'metrology' }],
  templates: [template],
  runs: [runB, deleted, { ...derivedRun, results: { etchRate: 85.2 }, derivedKeys: ['etchRate'], recipe: 'LNF_Oxide', notes: 'good', tags: ['a', 'b'] }, runA],
  measurements: [post, pre, { ...pre, id: 'm3', deleted: true }],
  events: [cleanEvent],
};

test('allRunsTable and allRunsCsv: one row per live run, oldest first, with parameters, results and measurements', () => {
  const rows = allRunsTable(input);
  const head = /** @type {string[]} */ (rows[0]);
  assert.deepEqual(head.slice(0, 4), ['date', 'tool', 'category', 'template']);
  for (const c of ['p.icpPower', 'p.time', 'r.etchRate', 'm.post.thickness [nm]', 'm.pre.thickness [nm]', 'measurements', 'id']) assert.ok(head.includes(c), c);
  assert.deepEqual(rows.slice(1).map((r) => r[head.indexOf('id')]), ['A', 'B', 'D'], 'deleted runs are left out');
  const d = rows[3];
  assert.equal(d[head.indexOf('recipe')], 'LNF_Oxide');
  assert.equal(d[head.indexOf('tags')], 'a; b');
  assert.equal(d[head.indexOf('p.time')], 300);
  assert.equal(d[head.indexOf('m.post.thickness [nm]')], 575);
  assert.match(String(d[head.indexOf('measurements')]), /^Pre thickness of SiO2: 1000 nm \(5 points, uniformity 0\.2%, Woollam\); Post thickness/);
  assert.equal(d[head.indexOf('date')], localStamp(derivedRun.startedAt));
  const csv = allRunsCsv(input);
  assert.ok(csv.startsWith('date,tool,category,template,'));
  assert.equal(csv.split('\r\n').length, 5, 'header, three runs and the final line end');
});

test('allSheets: all runs, one sheet per tool with labelled columns, measurements and events', () => {
  const sheets = allSheets(input);
  assert.deepEqual(sheets.map((s) => s.name), ['All runs', 'ICP', 'Measurements', 'Tool events']);
  const icp = sheets[1].rows;
  const head = /** @type {string[]} */ (icp[0]);
  for (const c of ['Date', 'Recipe', 'ICP power (W)', 'Time (s)', 'Chuck temp (°C)', 'Etch rate (nm/min)', 'Measurements']) assert.ok(head.includes(c), c);
  assert.ok(head.indexOf('Chuck temp (°C)') < head.indexOf('Etch rate (nm/min)'), 'inputs and context before outputs');
  assert.deepEqual(icp[1][0], { date: Date.parse(runA.startedAt) });
  assert.equal(sheets[2].rows.length, 3, 'header and the two live measurements');
  assert.equal(sheets[2].rows[1][10], 1000);
  assert.deepEqual(sheets[3].rows[1].slice(1), ['ICP etcher', 'Chamber clean', true, '']);
});

test('reportBlocks: a title, then each tool with every run and its events', () => {
  const blocks = reportBlocks(input, { now: Date.parse('2026-10-21T12:00:00Z'), who: 'by tester' });
  assert.equal(blocks[0].kind, 'title');
  assert.match(/** @type {any} */ (blocks[1]).text, /3 runs on 1 tool · 2 measurements · 1 tool event$/);
  assert.ok(blocks.some((b) => b.kind === 'h1' && b.text === 'ICP etcher'));
  const kv = blocks.filter((b) => b.kind === 'kv').map((b) => /** @type {any} */ (b));
  assert.ok(kv.some((b) => b.label === 'Inputs' && b.text.includes('ICP power 400 W') && b.text.includes('Time 5:00')));
  assert.ok(kv.some((b) => b.label === 'Results' && b.text === 'Etch rate 85.2 nm/min (derived)'));
  assert.ok(kv.some((b) => b.label === 'Notes' && b.text === 'good'));
  assert.ok(kv.some((b) => b.text.startsWith('Chamber clean (major)')));
  assert.ok(pdfBytes(blocks).length > 1000);
  assert.equal(measurementText({ phase: 'post', kind: 'cd', points: [], unit: 'µm' }), 'Post cd: no points');
});

test('review fixes: material-aware measurement columns, cell cap, long words, NFC, counts, other values', () => {
  // A mask measured last does not replace the film's value; it gets its own column.
  const film = { ...measurement('f1', 'post', [575, 575]), material: '' };
  const mask = { ...measurement('k1', 'post', [1300, 1300], 'Photoresist'), takenAt: '2026-10-19T14:00:00Z' };
  const rows = allRunsTable({ ...input, measurements: [film, mask] });
  const head = /** @type {string[]} */ (rows[0]);
  const d = rows.find((r) => r[head.indexOf('id')] === 'D') || [];
  assert.equal(d[head.indexOf('m.post.thickness [nm]')], 575);
  assert.equal(d[head.indexOf('m.post.thickness Photoresist [nm]')], 1300);
  // Excel's 32767-character cap never cuts an escaped character in half.
  const big = dec.decode(unzip(xlsxBytes([{ name: 'S', rows: [['h'], ['a'.repeat(32766) + '&&&']] }])).get('xl/worksheets/sheet1.xml'));
  assert.match(big, /a&amp;<\/t>/);
  // A very long word wraps quickly.
  const t0 = Date.now();
  assert.ok(wrap('x'.repeat(20000), 9.5, false, 400).length > 100);
  assert.ok(Date.now() - t0 < 2000, 'wrap is not cubic');
  assert.deepEqual(winAnsi('10 \u2126 e\u0301'), [...'10 Ohm '].map((c) => c.charCodeAt(0)).concat(0xe9));
  // Only tools with runs count as tools in the summary; values of removed fields still print.
  const blocks = reportBlocks({ ...input, events: [cleanEvent, { ...cleanEvent, id: 'e2', toolId: 'ellipsometer' }],
    runs: [{ ...runA, params: { ...runA.params, oldKnob: 7 } }] }, { now: Date.parse('2026-10-21T12:00:00Z') });
  assert.match(/** @type {any} */ (blocks[1]).text, /1 run on 1 tool/);
  assert.ok(blocks.some((b) => b.kind === 'kv' && b.label === 'Other values' && b.text === 'oldKnob 7'));
});
