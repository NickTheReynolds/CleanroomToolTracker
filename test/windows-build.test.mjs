// @ts-check
// Windows desktop build: the .ico writer, the staging and stamping helpers,
// the csc response-file lines, and C# 5 conventions in desktop/windows/.
// Pure and cross-platform; the compiler check runs on Windows only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeIco, appIco, ICO_SIZES } from '../scripts/ico.mjs';
import { encodePng } from '../scripts/make-icons.mjs';
import { CACHE_RE } from '../scripts/bump-version.mjs';
import {
  APP_ORIGIN, CSC, TAR, LAUNCHER_SOURCES, SETUP_SOURCES, listFiles, hashFiles, readVersion, stampServiceWorker,
  stampVersionJs, stageApp, rspLine, resourceOptions, buildInfoSource, manifestXml, thirdPartyNotices, assetFiles, checkAssets,
} from '../scripts/build-windows.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CS_DIR = join(ROOT, 'desktop', 'windows');
const onWindows = process.platform === 'win32';

/** @param {number} size @returns {Buffer} a plain PNG of that size */
const png = (size) => encodePng(size, size, new Uint8Array(size * size * 4).fill(200));

/** @param {Buffer} ico */
function readIco(ico) {
  const count = ico.readUInt16LE(4);
  return {
    reserved: ico.readUInt16LE(0),
    type: ico.readUInt16LE(2),
    entries: Array.from({ length: count }, (_, i) => {
      const e = 6 + 16 * i;
      const length = ico.readUInt32LE(e + 8);
      const offset = ico.readUInt32LE(e + 12);
      return {
        width: ico[e] || 256, height: ico[e + 1] || 256, planes: ico.readUInt16LE(e + 4), bits: ico.readUInt16LE(e + 6),
        data: ico.subarray(offset, offset + length),
      };
    }),
  };
}

test('encodeIco writes an icon directory of PNG entries, smallest first', () => {
  const images = new Map([[256, png(256)], [16, png(16)], [48, png(48)]]);
  const ico = encodeIco(images);
  const { reserved, type, entries } = readIco(ico);
  assert.equal(reserved, 0);
  assert.equal(type, 1);
  assert.deepEqual(entries.map((e) => e.width), [16, 48, 256]);
  assert.deepEqual(entries.map((e) => e.height), [16, 48, 256]);
  for (const e of entries) {
    assert.equal(e.planes, 1);
    assert.equal(e.bits, 32);
    assert.ok(e.data.equals(/** @type {Buffer} */ (images.get(e.width))), `${e.width} px data`);
  }
  assert.equal(ico[6 + 32], 0, '256 px is stored as 0 in the directory');
  assert.equal(ico.length, 6 + 16 * 3 + [...images.values()].reduce((n, b) => n + b.length, 0));
});

test('encodeIco accepts a plain object keyed by size', () => {
  const ico = encodeIco({ 32: png(32), 24: png(24) });
  assert.deepEqual(readIco(ico).entries.map((e) => e.width), [24, 32]);
});

test('encodeIco rejects bad input', () => {
  assert.throws(() => encodeIco(new Map()), /at least one/);
  assert.throws(() => encodeIco({ 16: Buffer.from('not a png at all, really') }), /not a PNG/);
  assert.throws(() => encodeIco({ 32: png(16) }), /16 x 16/);
  assert.throws(() => encodeIco({ 0: png(16) }), /1-256/);
  assert.throws(() => encodeIco({ 257: png(16) }), /1-256/);
  const twice = /** @type {Map<number, Uint8Array>} */ (/** @type {unknown} */ (new Map([[16, png(16)], ['16', png(16)]])));
  assert.throws(() => encodeIco(twice), /twice/);
});

test('appIco has every desktop size, each a PNG of the right size', () => {
  const { entries } = readIco(appIco());
  assert.deepEqual(entries.map((e) => e.width), ICO_SIZES);
  assert.deepEqual(ICO_SIZES, [16, 24, 32, 48, 64, 128, 256]);
  for (const e of entries) {
    assert.equal(e.data.toString('ascii', 1, 4), 'PNG');
    assert.equal(e.data.readUInt32BE(16), e.width);
    assert.equal(e.data.readUInt32BE(20), e.width);
  }
});

const SW = "// sw\nconst CACHE_NAME = 'lnf-runlog-v1.2.3-dev';\nconst ASSETS = ['./'];\n";
const VERSION = "// @ts-check\nexport const APP_VERSION = '1.2.3';\nexport const APP_BUILD = 'dev';\n";

test('stampServiceWorker and stampVersionJs change only their own line', () => {
  const sw = stampServiceWorker(SW, '1.2.3', 'abcd1234');
  assert.equal(sw, SW.replace("'lnf-runlog-v1.2.3-dev'", "'lnf-runlog-v1.2.3-dabcd1234'"));
  assert.equal(CACHE_RE.exec(sw)?.[1], '1.2.3-dabcd1234', 'still matches the bump script and starts with the version');
  const v = stampVersionJs(VERSION, 'abcd1234');
  assert.equal(v, VERSION.replace("APP_BUILD = 'dev'", "APP_BUILD = 'desktop-abcd1234'"));
  assert.equal(readVersion(v), '1.2.3');
  assert.throws(() => stampServiceWorker('const X = 1;', '1.2.3', 'abcd1234'), /CACHE_NAME/);
  assert.throws(() => stampVersionJs('const X = 1;', 'abcd1234'), /APP_BUILD/);
  assert.throws(() => readVersion('const X = 1;'), /APP_VERSION/);
});

test('the real app/sw.js and app/version.js still have the lines the build stamps', () => {
  const versionSrc = readFileSync(join(ROOT, 'app', 'version.js'), 'utf8');
  const version = readVersion(versionSrc);
  assert.match(stampServiceWorker(readFileSync(join(ROOT, 'app', 'sw.js'), 'utf8'), version, '0123abcd'), /'lnf-runlog-v[\d.]+-d0123abcd'/);
  assert.match(stampVersionJs(versionSrc, '0123abcd'), /APP_BUILD = 'desktop-0123abcd'/);
});

/** A small fake app folder. @returns {string} */
function fakeApp() {
  const dir = mkdtempSync(join(tmpdir(), 'lnf-winbuild-app-'));
  mkdirSync(join(dir, 'js', 'core'), { recursive: true });
  mkdirSync(join(dir, 'icons'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>\n');
  writeFileSync(join(dir, 'sw.js'), SW);
  writeFileSync(join(dir, 'version.js'), VERSION);
  writeFileSync(join(dir, 'js', 'core', 'a.js'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'icons', 'i.png'), png(16));
  return dir;
}

/** @param {string} dir @returns {Record<string, string>} sha-256 per file */
const snapshot = (dir) => Object.fromEntries(listFiles(dir).map((f) => [f, createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')]));

test('listFiles and hashFiles: sorted forward-slash paths and a stable 8-digit hash', () => {
  const dir = fakeApp();
  try {
    const files = listFiles(dir);
    assert.deepEqual(files, ['icons/i.png', 'index.html', 'js/core/a.js', 'sw.js', 'version.js']);
    const h = hashFiles(dir, files);
    assert.match(h, /^[0-9a-f]{8}$/);
    assert.equal(hashFiles(dir, [...files].reverse()), h, 'input order does not matter');
    writeFileSync(join(dir, 'js', 'core', 'a.js'), 'export const a = 2;\n');
    assert.notEqual(hashFiles(dir, files), h, 'content changes the hash');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stageApp copies the app verbatim, stamps only the copies, and never touches the source', () => {
  const app = fakeApp();
  const out = mkdtempSync(join(tmpdir(), 'lnf-winbuild-out-'));
  try {
    writeFileSync(join(out, 'stale.js'), 'old');
    const before = snapshot(app);
    const { version, hash8, files } = stageApp(app, join(out, 'app'));
    assert.deepEqual(snapshot(app), before, 'source files unchanged');
    assert.equal(version, '1.2.3');
    assert.equal(hash8, hashFiles(app, files));
    assert.deepEqual(listFiles(join(out, 'app')), files);
    const staged = snapshot(join(out, 'app'));
    for (const f of files.filter((x) => x !== 'sw.js' && x !== 'version.js')) assert.equal(staged[f], before[f], f);
    assert.match(readFileSync(join(out, 'app', 'sw.js'), 'utf8'), new RegExp(`'lnf-runlog-v1\\.2\\.3-d${hash8}'`));
    assert.match(readFileSync(join(out, 'app', 'version.js'), 'utf8'), new RegExp(`APP_BUILD = 'desktop-${hash8}'`));
    writeFileSync(join(out, 'app', 'leftover.js'), 'x');
    stageApp(app, join(out, 'app'));
    assert.ok(!existsSync(join(out, 'app', 'leftover.js')), 'a re-stage replaces the folder');
  } finally {
    rmSync(app, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('the build checks the app listing against the service worker\'s ASSETS', () => {
  const sw = "const CACHE_NAME = 'x';\nconst ASSETS = [\n  './',\n  'index.html',\n  'js/a.js',\n  'js/a.js',\n];\n";
  assert.deepEqual(assetFiles(sw), ['index.html', 'js/a.js', 'sw.js']);
  assert.throws(() => assetFiles('const X = 1;'), /ASSETS/);
  checkAssets(['index.html', 'js/a.js', 'sw.js'], sw);
  assert.throws(() => checkAssets(['index.html', 'sw.js'], sw), /Not found in app\/: js\/a\.js\./);
  assert.throws(() => checkAssets(['index.html', 'js/a.js', 'js/b.js', 'sw.js'], sw), /Not in ASSETS: js\/b\.js\./);
  // The real app: what npm test keeps true, so a real build never trips on it.
  checkAssets(listFiles(join(ROOT, 'app')), readFileSync(join(ROOT, 'app', 'sw.js'), 'utf8'));
});

test('response-file lines: quoted when spaced, payload resources named payload/<rel>', () => {
  assert.equal(rspLine('/target:winexe'), '/target:winexe');
  assert.equal(rspLine('/out:a b\\c.exe'), '"/out:a b\\c.exe"');
  assert.throws(() => rspLine('/out:"x".exe'), /ASCII/);
  assert.throws(() => rspLine('/out:café.exe'), /ASCII/);
  const lines = resourceOptions('payload', ['LNF Run Log.exe', 'app/js/main.js']);
  assert.deepEqual(lines, [
    `/resource:${join('payload', 'LNF Run Log.exe')},payload/LNF Run Log.exe`,
    `/resource:${join('payload', 'app', 'js', 'main.js')},payload/app/js/main.js`,
  ]);
  assert.equal(rspLine(lines[0]), `"${lines[0]}"`);
  assert.throws(() => resourceOptions('payload', ['a,b.js']), /comma/);
});

test('generated C#, manifests and notices', () => {
  const cs = buildInfoSource('1.2.3', 'abcd1234');
  assert.match(cs, /Version = "1\.2\.3";/);
  assert.match(cs, /FileVersion = "1\.2\.3\.0";/);
  assert.match(cs, /Build = "desktop-abcd1234";/);
  assert.match(cs, /TargetFramework\("\.NETFramework,Version=v4\.8"/);
  assert.throws(() => buildInfoSource('1.2', 'abcd1234'), /Bad version/);
  assert.throws(() => buildInfoSource('1.2.3', 'xyz'), /Bad version/);
  for (const pm of [true, false]) assert.match(manifestXml(pm), /requestedExecutionLevel level="asInvoker"/);
  assert.match(manifestXml(true), /PerMonitorV2/);
  assert.doesNotMatch(manifestXml(false), /PerMonitorV2/);
  const notes = thirdPartyNotices('Copyright (C) Microsoft\nLicense text\n', '1.0.1');
  assert.match(notes, /Microsoft\.Web\.WebView2 1\.0\.1 NuGet package/);
  assert.match(notes, /License text/);
  assert.doesNotMatch(notes, /[^\r]\n/, 'CRLF line ends');
});

/**
 * C# code with comments removed and string/char literals emptied, so
 * syntax checks do not trip on prose.
 * @param {string} src
 */
function csCode(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@"(?:[^"]|"")*"|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)+'/g, (m) => (m.startsWith('@') ? '@""' : m[0] + m[0]))
    .replace(/\/\/.*$/gm, '');
}

const csFiles = existsSync(CS_DIR) ? readdirSync(CS_DIR).filter((f) => f.endsWith('.cs')) : [];

test('desktop/windows C# stays within C# 5 (the compiler built into Windows)', () => {
  assert.ok(csFiles.length >= 5);
  const banned = [
    [/\$@?"/, 'string interpolation $"..."'],
    [/\?\.|\?\[/, 'null-conditional ?. or ?['],
    [/\bnameof\s*\(/, 'nameof'],
    [/\bout\s+var\b/, 'out var'],
    [/\{\s*get;\s*(?:private\s+)?(?:set;\s*)?\}\s*=/, 'auto-property initializer'],
    [/^\s*(?:(?:public|private|protected|internal|static|override|virtual|async|sealed|new)\s+)+[\w<>[\],.]+\s+\w+\s*(?:\([^)]*\))?\s*=>/m,
      'expression-bodied member'],
    [/\bis\s+var\b|\bwhen\s*\(|\?\?\s*throw\b/, 'C# 7 pattern'],
  ];
  for (const f of csFiles) {
    const code = csCode(readFileSync(join(CS_DIR, f), 'utf8'));
    for (const [re, what] of banned) assert.doesNotMatch(code, /** @type {RegExp} */ (re), `${f} uses ${what}`);
  }
});

test('the build compiles every C# file, and the fixed identities match', () => {
  for (const f of [...LAUNCHER_SOURCES, ...SETUP_SOURCES]) assert.ok(csFiles.includes(f), `${f} is missing`);
  for (const f of csFiles) assert.ok(LAUNCHER_SOURCES.includes(f) || SETUP_SOURCES.includes(f), `${f} is not in the build`);
  // The origin keys every user's IndexedDB data: changing it strands the data.
  assert.equal(APP_ORIGIN, 'https://app.lnf-runlog.example');
  assert.match(readFileSync(join(CS_DIR, 'Launcher.cs'), 'utf8'), /public const string AppHost = "app\.lnf-runlog\.example";/);
  assert.match(readFileSync(join(CS_DIR, 'Shell.cs'), 'utf8'), /public const string AppUserModelId = "LNFRunLog\.Desktop";/);
});

test('the setup sources compile with the Windows C# compiler', { skip: !onWindows && 'needs Windows' }, () => {
  assert.ok(existsSync(TAR), `${TAR} is part of Windows 10 1803 and later`);
  const dir = mkdtempSync(join(tmpdir(), 'lnf-winbuild-csc-'));
  try {
    writeFileSync(join(dir, 'BuildInfo.cs'), buildInfoSource('1.2.3', 'abcd1234'));
    const r = spawnSync(CSC, [
      '/nologo', '/codepage:65001', '/target:winexe', `/out:${join(dir, 'setup.exe')}`,
      '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
      ...SETUP_SOURCES.map((f) => join(CS_DIR, f)), join(dir, 'BuildInfo.cs'),
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `csc failed:\n${r.stdout}${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
