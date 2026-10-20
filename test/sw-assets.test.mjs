// @ts-check
// PWA shell checks: the service worker precaches exactly the files in app/,
// versions agree, the manifest icons exist, and index.html has the iOS/Android tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_RE, CACHE_RE } from '../scripts/bump-version.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

/** @param {string} dir */
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(relative(APP, p).split('\\').join('/'));
  }
  return out;
}

async function swAssets() {
  const src = await readFile(join(APP, 'sw.js'), 'utf8');
  const m = /const ASSETS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(m, 'ASSETS list not found in sw.js');
  return { src, assets: [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) };
}

test('sw.js precaches every app file (and nothing missing)', async () => {
  const { assets } = await swAssets();
  const files = (await walk(APP)).filter((f) => f !== 'sw.js');
  const listed = new Set(assets.filter((a) => a !== './'));
  const missing = files.filter((f) => !listed.has(f));
  const extra = [...listed].filter((f) => !files.includes(f));
  assert.deepEqual(missing, [], `Add to ASSETS in app/sw.js: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `ASSETS lists files that do not exist: ${extra.join(', ')}`);
  assert.ok(assets.includes('./'), 'the scope root "./" must be precached');
  assert.equal(new Set(assets).size, assets.length, 'ASSETS has duplicates');
});

test('version.js and the service worker cache name agree', async () => {
  const version = VERSION_RE.exec(await readFile(join(APP, 'version.js'), 'utf8'));
  const cache = CACHE_RE.exec((await swAssets()).src);
  assert.ok(version && cache);
  assert.ok(cache[1].startsWith(`${version[1]}-`), `cache ${cache[1]} does not match version ${version[1]}`);
  const pkg = JSON.parse(await readFile(join(APP, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.version, version[1], 'package.json version differs from app/version.js');
});

test('manifest is valid and its icons exist with the right sizes', async () => {
  const m = JSON.parse(await readFile(join(APP, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  const purposes = m.icons.map((/** @type {any} */ i) => i.purpose);
  assert.ok(purposes.includes('maskable'));
  for (const icon of m.icons) {
    const buf = await readFile(join(APP, icon.src));
    if (icon.type === 'image/png') {
      assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG', `${icon.src} is not a PNG`);
      const [w, h] = icon.sizes.split('x').map(Number);
      assert.equal(buf.readUInt32BE(16), w, `${icon.src} width`);
      assert.equal(buf.readUInt32BE(20), h, `${icon.src} height`);
    }
  }
  const touch = await readFile(join(APP, 'icons', 'apple-touch-icon.png'));
  assert.equal(touch.readUInt32BE(16), 180);
  assert.ok((await stat(join(APP, 'icons', 'icon.svg'))).size > 100);
});

test('index.html has the iOS and Android meta tags and relative paths', async () => {
  const html = await readFile(join(APP, 'index.html'), 'utf8');
  for (const needle of [
    'viewport-fit=cover', 'name="theme-color"', 'name="mobile-web-app-capable"', 'name="apple-mobile-web-app-capable"',
    'name="apple-mobile-web-app-status-bar-style"', 'rel="apple-touch-icon"', 'rel="manifest"', 'id="view"',
  ]) assert.ok(html.includes(needle), `index.html is missing ${needle}`);
  assert.ok(!/(src|href)="\/(?!\/)/.test(html), 'use relative paths so the app works under a sub-path');
  assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), 'no external resources');
});
