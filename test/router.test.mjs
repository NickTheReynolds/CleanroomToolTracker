// @ts-check
// Hash routing: parsing, matching, and that every route's view module exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHash, matchRoute, ROUTES } from '../app/js/router.js';

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
