// @ts-check
// Pure helpers outside core: recency ordering, field keys, photo sizing,
// the dev server's path guard, version bumps and the PNG encoder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { materialsByRecency, lastUsedByTool } from '../app/js/data/repo.js';
import { byRecent, materialMatches } from '../app/js/ui/pickers.js';
import { keyFromLabel } from '../app/js/ui/field-spec-editor.js';
import { fitWithin } from '../app/js/data/photos.js';
import { resolvePath } from '../serve.mjs';
import { nextVersion } from '../scripts/bump-version.mjs';
import { encodePng, iconSvg } from '../scripts/make-icons.mjs';

/** @param {string} toolId @param {string} startedAt @param {Record<string, string>} [extra] */
const run = (toolId, startedAt, extra = {}) => /** @type {any} */ ({ toolId, startedAt, material: '', substrate: '', maskMaterial: '', ...extra });

test('materialsByRecency puts recently used materials first, then the list order', () => {
  const runs = [
    run('t', '2026-10-01T00:00:00Z', { material: 'Au' }),
    run('t', '2026-10-05T00:00:00Z', { material: 'sio2 (thermal)' }),
    run('t', '2026-10-03T00:00:00Z', { material: 'Au' }),
    run('t', '2026-10-04T00:00:00Z', { material: 'Pt' }),
  ];
  assert.deepEqual(materialsByRecency(['Si', 'SiO2 (thermal)', 'Au', 'Cr'], runs, 'material'),
    ['sio2 (thermal)', 'Pt', 'Au', 'Si', 'Cr']);
  assert.deepEqual(materialsByRecency(['Si'], [], 'substrate'), ['Si']);
});

test('lastUsedByTool and byRecent order tools recently used first, then by name', () => {
  const used = lastUsedByTool([run('b', '2026-10-01T00:00:00Z'), run('b', '2026-10-09T00:00:00Z'), run('c', '2026-10-05T00:00:00Z')]);
  assert.equal(used.get('b'), Date.parse('2026-10-09T00:00:00Z'));
  const tools = /** @type {any[]} */ ([{ id: 'a', name: 'Zeta' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }, { id: 'd', name: 'Alpha' }]);
  assert.deepEqual(byRecent(tools, used).map((t) => t.id), ['b', 'c', 'd', 'a']);
});

test('materialMatches: word prefixes of the name or the wiki\'s other names', () => {
  assert.ok(materialMatches('Au', 'gold'));
  assert.ok(materialMatches('Au', ' GO '));
  assert.ok(materialMatches('SiO2 (PECVD)', 'sio2 pecvd'));
  assert.ok(materialMatches('SiO2 (PECVD)', 'SiO₂'));
  assert.ok(materialMatches('SiO2 (PECVD)', 'p5000'));
  assert.ok(materialMatches('LiNbO3 (bulk)', 'lithium niobate'));
  assert.ok(materialMatches('SPR 220 3.0', 'spr 220'));
  assert.ok(materialMatches('My custom film', 'custom'));
  assert.ok(materialMatches('Anything', ''));
  assert.ok(!materialMatches('Positive resist', 'si'), 'only word starts count');
  assert.ok(!materialMatches('SiO2 (PECVD)', 'sio2 thermal'), 'every query word must match');
  assert.ok(!materialMatches('Au', 'silver'));
});

test('keyFromLabel makes unique camelCase keys', () => {
  assert.equal(keyFromLabel('ICP power', []), 'icpPower');
  assert.equal(keyFromLabel('O2', []), 'o2');
  assert.equal(keyFromLabel('Chuck temp (°C)', []), 'chuckTempC');
  assert.equal(keyFromLabel('Température', []), 'temperature');
  assert.equal(keyFromLabel('2nd pass', []), 'f2ndPass');
  assert.equal(keyFromLabel('ICP power', ['icpPower', 'icpPower2']), 'icpPower3');
  assert.equal(keyFromLabel('', []), 'field');
});

test('fitWithin scales the long edge down and never up', () => {
  assert.deepEqual(fitWithin(4032, 3024, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3024, 4032, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
});

test('the dev server never serves files outside app/', () => {
  const root = join(sep === '\\' ? 'C:\\' : '/', 'srv', 'app');
  assert.equal(resolvePath(root, '/'), join(root, 'index.html'));
  assert.equal(resolvePath(root, '/js/main.js?v=2'), join(root, 'js', 'main.js'));
  assert.equal(resolvePath(root, '/../secret.txt'), join(root, 'secret.txt'));
  assert.equal(resolvePath(root, '/..%2f..%2fsecret.txt'), null);
  assert.equal(resolvePath(root, '/%2e%2e/%2e%2e/secret.txt'), join(root, 'secret.txt'));
  assert.equal(resolvePath(root, '/a%00b'), null);
  assert.equal(resolvePath(root, '/%E0%A4%A'), null);
});

test('nextVersion bumps patch, minor, major or takes an explicit version', () => {
  assert.equal(nextVersion('1.2.3'), '1.2.4');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.2.3', '4.0.1'), '4.0.1');
  assert.throws(() => nextVersion('1.2.3', 'huge'));
});

test('encodePng writes a valid RGBA PNG and the SVG icon is well formed', () => {
  const px = new Uint8Array(2 * 2 * 4).fill(200);
  const png = encodePng(2, 2, px);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png[25], 6);
  const idatLen = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, (2 * 4 + 1) * 2);
  assert.match(iconSvg(), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*<\/svg>\n$/);
});
