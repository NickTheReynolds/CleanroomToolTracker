// @ts-check
// Hash routing: parsing, matching, and that every route's view module exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHash, matchRoute, ROUTES, track, canGoBack, navigate } from '../app/js/router.js';

const APP_JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js');

test('parseHash splits path and query and normalises slashes', () => {
  assert.equal(parseHash('').path, '/');
  assert.equal(parseHash('#/').path, '/');
  assert.equal(parseHash('#/history/').path, '/history');
  assert.equal(parseHash('#history').path, '/history');
  const p = parseHash('#/event?tool=abc&x=1');
  assert.equal(p.path, '/event');
  assert.equal(p.query.get('tool'), 'abc');
});

test('matchRoute finds views and decodes parameters', () => {
  assert.equal(matchRoute('/')?.route.pattern, '/');
  const run = matchRoute('/run/1ed09dbc-941f-4056-8b83-ae2312c7f083');
  assert.equal(run?.route.pattern, '/run/:id');
  assert.equal(run?.params.id, '1ed09dbc-941f-4056-8b83-ae2312c7f083');
  assert.deepEqual(matchRoute('/log/t1/p2')?.params, { toolId: 't1', templateId: 'p2' });
  assert.equal(matchRoute('/run/abc/measure')?.route.pattern, '/run/:runId/measure');
  assert.equal(matchRoute('/tool/a%20b')?.params.id, 'a b');
  assert.equal(matchRoute('/nope'), null);
  assert.equal(matchRoute('/run'), null);
  assert.equal(matchRoute('/tool/%E0%A4%A'), null, 'malformed escapes do not match');
});

test('every route points to an existing view module with a render export', () => {
  for (const r of ROUTES) {
    const m = /import\('\.\/(views\/[a-z-]+\.js)'\)/.exec(r.load.toString());
    assert.ok(m, `cannot read the module of ${r.pattern}`);
    const file = join(APP_JS, m[1]);
    assert.ok(existsSync(file), `${r.pattern}: ${m[1]} is missing`);
    assert.match(readFileSync(file, 'utf8'), /export async function render\(/, `${m[1]} has no render()`);
    if (r.parent) assert.ok(matchRoute(r.parent), `${r.pattern}: parent ${r.parent} is not a route`);
  }
});

test('project routes: "new" opens the editor, an id the project page', () => {
  assert.equal(matchRoute('/project/new')?.route.pattern, '/project/new');
  assert.equal(matchRoute('/project/abc')?.route.pattern, '/project/:id');
  assert.equal(matchRoute('/project/abc')?.params.id, 'abc');
  assert.equal(matchRoute('/project/abc/edit')?.route.pattern, '/project/:id/edit');
  assert.equal(matchRoute('/settings/my-tools')?.route.pattern, '/settings/my-tools');
});

test('Save or Cancel back to the page before goes back instead of stacking a copy of it', () => {
  // Home -> Projects -> a project -> its editor.
  for (const p of ['/', '/projects', '/project/x', '/project/x/edit']) track(p, false);
  assert.equal(canGoBack(), true);
  const calls = [];
  const win = {
    location: { hash: '#/project/x/edit', replace: (/** @type {string} */ h) => calls.push(`replace ${h}`) },
    history: { back: () => calls.push('back') },
  };
  const saved = /** @type {any} */ (globalThis).window;
  /** @type {any} */ (globalThis).window = win;
  try {
    navigate('/project/x', { replace: true });
    assert.deepEqual(calls, ['back'], 'the editor returns to the project page by going back');
    navigate('/projects', { replace: true });
    assert.deepEqual(calls, ['back', 'replace #/projects'], 'another page still replaces the entry');
  } finally {
    /** @type {any} */ (globalThis).window = saved;
  }
  track('/project/x', false);
  track('/projects', false);
  track('/', false);
  assert.equal(canGoBack(), false, 'back on the first page leaves Back to the route parent');
});
