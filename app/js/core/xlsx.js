// @ts-check
/**
 * A minimal Excel workbook (.xlsx) writer with no dependencies: one sheet
 * per table, the first row bold, frozen and filterable, numbers as numbers
 * and dates as Excel dates. The file is a zip archive with stored
 * (uncompressed) entries, which every spreadsheet program opens.
 */

/**
 * A cell: text, a number, true/false, empty, or a date (epoch ms, shown in
 * local time).
 * @typedef {string | number | boolean | null | undefined | {date: number}} XlsxCell
 */

/**
 * @typedef {Object} XlsxSheet
 * @property {string} name sheet tab name (made safe and unique)
 * @property {XlsxCell[][]} rows the first row is the header
 * @property {number[]} [widths] column widths in characters
 */

const enc = new TextEncoder();

/** @type {Uint32Array | null} */
let CRC_TABLE = null;

/**
 * CRC-32 (the zip checksum).
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A zip archive of stored (uncompressed) files.
 * @param {{name: string, data: Uint8Array}[]} files names in ASCII
 * @param {Date} [when] the files' modification time
 * @returns {Uint8Array}
 */
export function zipStore(files, when = new Date(2026, 0, 1)) {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  /** @type {Uint8Array[]} */
  const parts = [];
  /** @type {Uint8Array[]} */
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * Text safe for XML (control characters other than tab and newline dropped).
 * @param {string} s
 * @returns {string}
 */
export function xmlText(s) {
  return String(s).replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * "A", "B", ... "Z", "AA" for a 0-based column index.
 * @param {number} i
 * @returns {string}
 */
export function columnName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Excel's serial day number of a moment, in local time.
 * @param {number} ms epoch ms
 * @returns {number}
 */
export function excelDate(ms) {
  const d = new Date(ms);
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return local / 86400000 + 25569;
}

/**
 * @param {XlsxCell} v
 * @param {string} ref
 * @param {boolean} header
 * @returns {string}
 */
function cellXml(v, ref, header) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'object' && 'date' in v) {
    return Number.isFinite(v.date) ? `<c r="${ref}" s="2"><v>${excelDate(v.date)}</v></c>` : '';
  }
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${header ? ' s="1"' : ''}><v>${v}</v></c>` : '';
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${header ? ' s="1"' : ''}><v>${v ? 1 : 0}</v></c>`;
  // Excel holds at most 32767 characters a cell: cut before escaping, never inside an entity.
  const text = xmlText(String(v).slice(0, 32767));
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t${space}>${text}</t></is></c>`;
}

/**
 * @param {XlsxSheet} sheet
 * @returns {string}
 */
function sheetXml(sheet) {
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const rows = sheet.rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellXml(v, `${columnName(j)}${i + 1}`, i === 0)).join('')}</row>`);
  const cols = (sheet.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, w))}" customWidth="1"/>`);
  const last = `${columnName(width - 1)}${Math.max(1, sheet.rows.length)}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + (cols.length ? `<cols>${cols.join('')}</cols>` : '')
    + `<sheetData>${rows.join('')}</sheetData>`
    + (sheet.rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : '')
    + '</worksheet>';
}

/**
 * Sheet names: at most 31 characters, none of []:*?/\, unique.
 * @param {string[]} names
 * @returns {string[]}
 */
export function sheetNames(names) {
  /** @type {string[]} */
  const out = [];
  for (const n of names) {
    const base = (String(n).replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet').slice(0, 31);
    let name = base;
    for (let i = 2; out.some((x) => x.toLowerCase() === name.toLowerCase()); i++) name = `${base.slice(0, 27)} (${i})`;
    out.push(name);
  }
  return out;
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
  + '</styleSheet>';

/**
 * A complete .xlsx file.
 * @param {XlsxSheet[]} sheets
 * @returns {Uint8Array}
 */
export function xlsxBytes(sheets) {
  const names = sheetNames(sheets.map((s) => s.name));
  const n = sheets.length;
  const sheetList = names.map((name, i) => `<sheet name="${xmlText(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets>${sheetList}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>'],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zipStore(files.map(([name, text]) => ({ name, data: enc.encode(text) })));
}
