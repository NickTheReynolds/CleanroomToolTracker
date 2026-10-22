// @ts-check
// Tool photos that come with the app (DECISIONS.md 110): the shipped files,
// the generated list and precache lines, and the photo script's pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_PHOTOS } from '../app/js/data/tool-photos.js';
import { LNF_TOOLS } from '../app/js/data/seed-lnf.js';
import { TOOL_WIKI } from '../app/js/data/lnf-wiki.js';
import { pickPhoto, savedBase, savedName, savedFile, photoModule, swWithPhotos } from '../scripts/tool-photos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'app', 'img', 'tools');

test('every photo belongs to a seeded LNF tool with a wiki page, and every shipped file is used', () => {
  const seeded = new Set(LNF_TOOLS.map((r) => r[0]));
  assert.ok(Object.keys(TOOL_PHOTOS).length >= 100, 'most tools have a photo');
  for (const id of Object.keys(TOOL_PHOTOS)) {
    assert.ok(seeded.has(id), `${id} is not a seeded tool`);
    assert.ok(TOOL_WIKI[id], `${id} has no wiki page`);
  }
  const used = new Set(Object.values(TOOL_PHOTOS));
  for (const f of readdirSync(DIR)) assert.ok(used.has(f), `app/img/tools/${f} is not used by any tool`);
});

test('the photos are small JPEGs whose names carry their hash', () => {
  for (const f of new Set(Object.values(TOOL_PHOTOS))) {
    const bytes = readFileSync(join(DIR, f));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], `${f} is not a JPEG`);
    assert.ok(bytes.length < 80 * 1024, `${f} is ${Math.round(bytes.length / 1024)} KB`);
    assert.equal(f.slice(-12, -4), createHash('sha256').update(bytes).digest('hex').slice(0, 8), `${f}: the name's hash`);
  }
});

test('the photo list and the precache lines are what the script writes', () => {
  assert.equal(readFileSync(join(ROOT, 'app', 'js', 'data', 'tool-photos.js'), 'utf8'), photoModule({ ...TOOL_PHOTOS }));
  const sw = readFileSync(join(ROOT, 'app', 'sw.js'), 'utf8');
  assert.equal(swWithPhotos(sw, Object.values(TOOL_PHOTOS)), sw);
});

test('pickPhoto takes the numbered photo, or a page\'s only photo, never an icon', () => {
  assert.equal(pickPhoto(['File:10020.jpg', 'File:Etch material layers.png']), 'File:10020.jpg');
  assert.equal(pickPhoto(['File:Laurell.jpg']), 'File:Laurell.jpg');
  assert.equal(pickPhoto(['File:Warning.svg']), null);
  assert.equal(pickPhoto(['File:.jpg']), null);
  assert.equal(pickPhoto(['File:1.jpg', 'File:2.jpg']), null, 'two numbered photos: unclear');
  assert.equal(pickPhoto(['File:A.jpg', 'File:B.png']), null, 'two plain photos: unclear');
  assert.equal(pickPhoto(['File:7.jpg', 'File:7.jpg']), 'File:7.jpg');
  assert.equal(pickPhoto([]), null);
});

test('saved names: URL-safe, JPEG, with a content hash', () => {
  assert.equal(savedBase('File:Acid 80.jpg'), 'Acid-80');
  assert.equal(savedBase('File:Sentro Tech.png'), 'Sentro-Tech');
  assert.equal(savedBase('File:10020.JPG'), '10020');
  const name = savedName('10020', new Uint8Array([1, 2, 3]));
  assert.match(name, /^10020-[0-9a-f]{8}\.jpg$/);
  assert.equal(savedFile('10020', ['1002-0aaaaaaa.jpg', name, '10020.jpg']), name);
  assert.equal(savedFile('10020', ['10020.jpg', '100200-0aaaaaaa.jpg']), undefined);
});

test('swWithPhotos replaces only the lines between its markers, in the file\'s line ends', () => {
  const sw = "const ASSETS = [\r\n  'a.js',\r\n  // Tool photos (scripts/tool-photos.mjs keeps these lines).\r\n  'img/tools/old.jpg',\r\n  // End of tool photos.\r\n  'b.js',\r\n];\r\n";
  assert.equal(swWithPhotos(sw, ['b-1.jpg', 'a-1.jpg', 'a-1.jpg']),
    "const ASSETS = [\r\n  'a.js',\r\n  // Tool photos (scripts/tool-photos.mjs keeps these lines).\r\n  'img/tools/a-1.jpg',\r\n  'img/tools/b-1.jpg',\r\n  // End of tool photos.\r\n  'b.js',\r\n];\r\n");
  assert.throws(() => swWithPhotos('const ASSETS = [];', []), /markers/);
});
