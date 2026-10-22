#!/usr/bin/env node
// @ts-check
/**
 * Fail when any text file in the repo exceeds MAX_LINES (1000). Files over
 * WARN_LINES (600) are listed as a reminder to split them. Skipped: .git/,
 * binary files, and directories that .gitignore excludes (build outputs and
 * caches such as build/, dist/, .cache/ are not part of the repo).
 *
 *   node scripts/check-line-limits.mjs [root]
 */
import { readdir, readFile } from 'node:fs/promises';
import { realpathSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LINES = 1000;
export const WARN_LINES = 600;

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tif', '.tiff', '.heic',
  '.pdf', '.zip', '.gz', '.tgz', '.7z', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.mov', '.webm', '.wasm',
]);

/**
 * Count lines the way editors do: a trailing newline does not start a new line.
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  if (!text) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith('\n') ? n : n + 1;
}

/**
 * Binary by extension, or by a NUL byte in the first 8 KB.
 * @param {string} file
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function isBinary(file, buf) {
  if (BINARY_EXT.has(extname(file).toLowerCase())) return true;
  return buf.subarray(0, 8192).includes(0);
}

/**
 * Directory patterns from a .gitignore text: lines ending in "/" without
 * wildcards. A pattern with no other slash ("build/") matches a directory of
 * that name at any depth; one with a slash ("server/data/") matches that
 * path from the root, as in git.
 * @param {string} text
 * @returns {{names: Set<string>, paths: Set<string>}}
 */
export function ignoredDirs(text) {
  const names = new Set();
  const paths = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!') || !line.endsWith('/') || /[*?[\]]/.test(line)) continue;
    const p = line.replace(/^\//, '').replace(/\/$/, '');
    if (p.includes('/') || line.startsWith('/')) paths.add(p);
    else names.add(p);
  }
  return { names, paths };
}

/**
 * Every file under root except .git and the directories .gitignore excludes.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function listFiles(root) {
  const gi = join(root, '.gitignore');
  const ignored = existsSync(gi) ? ignoredDirs(readFileSync(gi, 'utf8')) : { names: new Set(), paths: new Set() };
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        const rel = relative(root, p).split('\\').join('/');
        if (ignored.names.has(entry.name) || ignored.paths.has(rel)) continue;
        await walk(p);
      } else if (entry.isFile()) {
        out.push(p);
      }
    }
  }
  await walk(root);
  return out.sort();
}

/**
 * @param {string} root
 * @param {{max?: number, warn?: number}} [opts]
 * @returns {Promise<{checked: number, over: {file: string, lines: number}[], warn: {file: string, lines: number}[]}>}
 */
export async function checkLineLimits(root, opts = {}) {
  const max = opts.max ?? MAX_LINES;
  const warnAt = opts.warn ?? WARN_LINES;
  const over = [];
  const warn = [];
  let checked = 0;
  for (const file of await listFiles(root)) {
    const buf = await readFile(file);
    if (isBinary(file, buf)) continue;
    checked++;
    const lines = countLines(buf.toString('utf8'));
    const rel = relative(root, file).split('\\').join('/');
    if (lines > max) over.push({ file: rel, lines });
    else if (lines > warnAt) warn.push({ file: rel, lines });
  }
  return { checked, over, warn };
}

async function main() {
  const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const { checked, over, warn } = await checkLineLimits(root);
  for (const w of warn) console.log(`note: ${w.file} has ${w.lines} lines (split files past ${WARN_LINES})`);
  if (over.length) {
    console.error(`Line limit exceeded (max ${MAX_LINES}):`);
    for (const o of over) console.error(`  ${o.file}: ${o.lines} lines`);
    process.exitCode = 1;
    return;
  }
  console.log(`Line limits OK: ${checked} text files, none over ${MAX_LINES} lines.`);
}

const isMain = () => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (isMain()) main();
