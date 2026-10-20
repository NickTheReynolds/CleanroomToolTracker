#!/usr/bin/env node
// @ts-check
/**
 * Bump the app version in app/version.js, the service worker cache name in
 * app/sw.js and package.json together, so installed apps fetch the update.
 *
 *   node scripts/bump-version.mjs            # patch: 1.0.0 -> 1.0.1
 *   node scripts/bump-version.mjs minor      # 1.0.1 -> 1.1.0
 *   node scripts/bump-version.mjs 2.0.0      # explicit
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION_RE = /export const APP_VERSION = '(\d+\.\d+\.\d+)';/;
export const CACHE_RE = /const CACHE_NAME = 'lnf-runlog-v([^']+)';/;

/**
 * @param {string} current "1.2.3"
 * @param {string} how "patch", "minor", "major" or an explicit "x.y.z"
 * @returns {string}
 */
export function nextVersion(current, how = 'patch') {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [maj, min, pat] = current.split('.').map(Number);
  if (how === 'major') return `${maj + 1}.0.0`;
  if (how === 'minor') return `${maj}.${min + 1}.0`;
  if (how === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Unknown bump "${how}" (use patch, minor, major or x.y.z)`);
}

function main() {
  const versionFile = join(ROOT, 'app', 'version.js');
  const swFile = join(ROOT, 'app', 'sw.js');
  const pkgFile = join(ROOT, 'package.json');
  const versionSrc = readFileSync(versionFile, 'utf8');
  const m = VERSION_RE.exec(versionSrc);
  if (!m) throw new Error('APP_VERSION not found in app/version.js');
  const next = nextVersion(m[1], process.argv[2]);
  const swSrc = readFileSync(swFile, 'utf8');
  if (!CACHE_RE.test(swSrc)) throw new Error('CACHE_NAME not found in app/sw.js');
  writeFileSync(versionFile, versionSrc.replace(VERSION_RE, `export const APP_VERSION = '${next}';`));
  writeFileSync(swFile, swSrc.replace(CACHE_RE, `const CACHE_NAME = 'lnf-runlog-v${next}-dev';`));
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  pkg.version = next;
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Version ${m[1]} -> ${next} (app/version.js, app/sw.js, package.json)`);
}

const isMain = () => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (isMain()) main();
