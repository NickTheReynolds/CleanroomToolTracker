// @ts-check
// Line-limit checker: counting, binary detection, .git exclusion, and the repo itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countLines, isBinary, checkLineLimits, MAX_LINES } from '../scripts/check-line-limits.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('countLines treats a trailing newline like an editor does', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines('a\r\nb\r\n'), 2);
  assert.equal(countLines('\n\n'), 2);
});

test('isBinary detects images by extension and NUL bytes', () => {
  assert.equal(isBinary('x.png', Buffer.from('text')), true);
  assert.equal(isBinary('x.bin', Buffer.from([65, 0, 66])), true);
  assert.equal(isBinary('x.js', Buffer.from('const a = 1;\n')), false);
});

test('checkLineLimits flags long files, warns on 600+, skips .git and binaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lnf-lines-'));
  try {
    await writeFile(join(dir, 'ok.js'), 'x\n'.repeat(10));
    await writeFile(join(dir, 'warn.css'), 'x\n'.repeat(700));
    await writeFile(join(dir, 'long.md'), 'x\n'.repeat(MAX_LINES + 1));
    await writeFile(join(dir, 'exact.txt'), 'x\n'.repeat(MAX_LINES));
    await writeFile(join(dir, 'pic.png'), 'x\n'.repeat(5000));
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'big'), 'x\n'.repeat(5000));
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'deep.json'), 'x\n'.repeat(1200));
    const r = await checkLineLimits(dir);
    assert.deepEqual(r.over.map((o) => o.file).sort(), ['long.md', 'sub/deep.json']);
    assert.deepEqual(r.warn.map((o) => o.file).sort(), ['exact.txt', 'warn.css']);
    assert.equal(r.checked, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every text file in this repo is within the line limit', async () => {
  const r = await checkLineLimits(ROOT);
  assert.deepEqual(r.over, [], `Files over ${MAX_LINES} lines: ${r.over.map((o) => `${o.file} (${o.lines})`).join(', ')}`);
  assert.ok(r.checked > 20);
});
