// @ts-check
// Code conventions from the spec: @ts-check everywhere, a pure core that imports
// nothing outside core/ (and config.js), no third-party requests (except tool photos
// from the LNF wiki, in one place), layering.
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

test('layers call only downwards: data never imports sync/ui/views; sync never imports ui/views; ui never imports views', async () => {
  for (const f of await walk(join(JS, 'data'))) {
    for (const spec of importsOf(await readFile(f, 'utf8'))) {
      assert.ok(!/\/(ui|views|sync)\//.test(spec) && !spec.includes('router'), `${relative(ROOT, f)} imports ${spec}`);
    }
  }
  for (const f of await walk(join(JS, 'sync'))) {
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
  // Resource loads: src/href attributes or properties, fetch(), import(),
  // CSS url() and @import, manifest "src". Plain text such as an example
  // address shown to the user is fine.
  const LOADS = [
    /\b(src|href)\s*[=:]\s*['"`]\s*(https?:)?\/\//i,
    /\bfetch\(\s*['"`]\s*(https?:)?\/\//i,
    /\bimport\(\s*['"`]\s*(https?:)?\/\//i,
    /\bimport\s+[^'"`]*['"`]\s*(https?:)?\/\//i,
    /url\(\s*['"]?\s*(https?:)?\/\//i,
    /@import\s+['"]?\s*(https?:)?\/\//i,
    /"src"\s*:\s*"(https?:)?\/\//i,
  ];
  for (const f of await walk(join(ROOT, 'app'), /\.(m?js|css|html|svg|webmanifest|json)$/)) {
    const src = await readFile(f, 'utf8');
    for (const re of LOADS) assert.ok(!re.test(src), `${relative(ROOT, f)} loads from another origin (${re})`);
  }
});

test('nothing in the app loads from the LNF wiki: only the data names its address, for links', async () => {
  for (const f of await walk(join(ROOT, 'app'), /\.(m?js|html|css|webmanifest)$/)) {
    const rel = relative(ROOT, f).split('\\').join('/');
    if (rel === 'app/js/data/lnf-wiki.js') continue;
    const src = await readFile(f, 'utf8');
    assert.ok(!src.includes('WIKI_HOST'), `${rel} uses WIKI_HOST`);
    assert.ok(rel.startsWith('app/js/data/') || !src.includes('lnf-wiki.eecs.umich.edu'), `${rel} names the wiki's address`);
  }
  assert.ok(!existsSync(join(ROOT, 'app', 'img', 'tools')), 'the app ships no tool photos (DECISIONS.md 77)');
});

test('only the sync client talks to GitHub (the one third-party host, used only when Sync runs)', async () => {
  for (const f of await walk(join(ROOT, 'app'), /\.(m?js|html)$/)) {
    const rel = relative(ROOT, f).split('\\').join('/');
    if (rel === 'app/js/sync/github.js') continue;
    assert.ok(!(await readFile(f, 'utf8')).includes('api.github.com'), `${rel} mentions api.github.com`);
  }
});

test('test browsers can never reach the LNF wiki', async () => {
  const { BLOCKED_HOSTS, BLOCK_HOSTS_ARG, BLOCK_HOSTS_SWITCH } = await import('../scripts/cdp.mjs');
  const { WIKI_HOST } = await import('../app/js/data/lnf-wiki.js');
  assert.ok(BLOCKED_HOSTS.includes(new URL(WIKI_HOST).hostname), 'scripts/cdp.mjs must block the wiki host');
  assert.ok(BLOCK_HOSTS_ARG.includes(`MAP ${new URL(WIKI_HOST).hostname} ~NOTFOUND`));
  const cdp = await readFile(join(ROOT, 'scripts', 'cdp.mjs'), 'utf8');
  assert.match(cdp, /'--hide-scrollbars', BLOCK_HOSTS_ARG, 'about:blank'/, 'launch() must pass BLOCK_HOSTS_ARG');
  const win = await readFile(join(ROOT, 'scripts', 'build-windows.mjs'), 'utf8');
  assert.ok(win.includes('${BLOCK_HOSTS_SWITCH}') && BLOCK_HOSTS_SWITCH.startsWith('--host-resolver-rules="'),
    'the desktop smoke test must pass BLOCK_HOSTS_SWITCH to WebView2');
});


test('package.json has no dependencies', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.type, 'module');
});
