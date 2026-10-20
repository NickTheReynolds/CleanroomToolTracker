// @ts-check
// Code conventions from the spec: @ts-check everywhere, a pure core that imports
// nothing outside core/ (and config.js), no third-party requests, layering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS = join(ROOT, 'app', 'js');

/**
 * @param {string} dir
 * @param {RegExp} [ext]
 * @returns {Promise<string[]>}
 */
async function walk(dir, ext = /\.m?js$/) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, ext));
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
}

/** @param {string} src @returns {string[]} static and dynamic import specifiers */
function importsOf(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [
    ...[...code.matchAll(/\bimport\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ...[...code.matchAll(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ];
}

test('every JS file in app/, scripts/, server/, test/ and the root starts with // @ts-check', async () => {
  const files = [
    ...await walk(join(ROOT, 'app')),
    ...await walk(join(ROOT, 'scripts')),
    ...await walk(join(ROOT, 'server')),
    ...await walk(join(ROOT, 'test')),
    join(ROOT, 'serve.mjs'),
  ];
  const missing = [];
  for (const f of files) {
    const first = (await readFile(f, 'utf8')).split('\n').find((l) => l.trim() && !l.startsWith('#!'));
    if (!first || first.trim() !== '// @ts-check') missing.push(relative(ROOT, f));
  }
  assert.deepEqual(missing, []);
});

test('core modules import only other core modules or config.js', async () => {
  for (const f of await walk(join(JS, 'core'))) {
    for (const spec of importsOf(await readFile(f, 'utf8'))) {
      const ok = spec.startsWith('./') || spec === '../config.js';
      assert.ok(ok, `${relative(ROOT, f)} imports ${spec}`);
    }
  }
});

test('layers call only downwards: data never imports ui/views; ui never imports views', async () => {
  for (const f of await walk(join(JS, 'data'))) {
    for (const spec of importsOf(await readFile(f, 'utf8'))) {
      assert.ok(!/\/(ui|views)\//.test(spec) && !spec.includes('router'), `${relative(ROOT, f)} imports ${spec}`);
    }
  }
  for (const f of await walk(join(JS, 'ui'))) {
    for (const spec of importsOf(await readFile(f, 'utf8'))) {
      assert.ok(!/\/views\//.test(spec), `${relative(ROOT, f)} imports ${spec}`);
    }
  }
});

test('views add children with the null-safe dom.js helpers', async () => {
  // Native append/replaceChildren print "null" for conditional children.
  for (const f of await walk(join(JS, 'views'))) {
    const src = await readFile(f, 'utf8');
    assert.ok(!/ctx\.root\.(append|replaceChildren)\(/.test(src), `${relative(ROOT, f)}: use append(ctx.root, [...]) from ui/dom.js`);
  }
});

test('views never touch IndexedDB directly', async () => {
  for (const f of await walk(join(JS, 'views'))) {
    const src = await readFile(f, 'utf8');
    assert.ok(!/indexedDB|IDBKeyRange|data\/db\.js/.test(src), `${relative(ROOT, f)} uses IndexedDB directly`);
  }
});

test('the app loads nothing from other origins', async () => {
  for (const f of await walk(join(ROOT, 'app'), /\.(m?js|css|html|svg|webmanifest|json)$/)) {
    const src = (await readFile(f, 'utf8')).replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
    assert.ok(!/https?:\/\/(?!localhost)/.test(src), `${relative(ROOT, f)} references an external URL`);
  }
});

test('package.json has no dependencies', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.type, 'module');
});
