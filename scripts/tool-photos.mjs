#!/usr/bin/env node
// @ts-check
/**
 * Ship the LNF wiki's photo of each LNF tool with the app: download it,
 * shrink it to a small JPEG in headless Chrome or Edge, and save it as
 * app/img/tools/<wiki file name>. Then rewrite the photo list in
 * app/js/data/tool-photos.js and the photo lines of the service worker's
 * precache list. Tools whose photo is not shipped show it straight from the
 * wiki when the wiki is reachable.
 *
 *   npm run photos                # from the live wiki (UMich network or VPN)
 *   npm run photos -- --archive   # from the Internet Archive's copies
 *
 * Needs Chrome or Edge, and a global WebSocket (Node 22+, or Node 20 with
 * --experimental-websocket). Photos already in app/img/tools are kept.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { TOOL_WIKI, WIKI_HOST } from '../app/js/data/lnf-wiki.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'app', 'img', 'tools');
const LIST = join(ROOT, 'app', 'js', 'data', 'tool-photos.js');
const SW = join(ROOT, 'app', 'sw.js');
/** Longest edge in pixels, and JPEG quality: about 30 KB a photo. */
const MAX_EDGE = 480;
const QUALITY = 0.74;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The file name a wiki photo is saved under: JPEG, whatever the wiki's format.
 * @param {string} path the photo's path on the wiki
 * @returns {string}
 */
export function savedName(path) {
  return (path.split('/').pop() || '').replace(/\.(png|gif|jpe?g)$/i, '.jpg');
}

/**
 * The photo list module and the precache lines for the photos in app/img/tools.
 * @param {string[]} files
 */
export function writeLists(files) {
  const sorted = [...files].sort();
  // Find the markers first (in the file's own line ends), so a failure changes neither file.
  const sw = readFileSync(SW, 'utf8');
  const nl = sw.includes('\r\n') ? '\r\n' : '\n';
  const head = `  // Tool photos (scripts/tool-photos.mjs keeps these lines).${nl}`;
  const start = sw.indexOf(head);
  const end = sw.indexOf(`  // End of tool photos.${nl}`);
  if (start < 0 || end < start) throw new Error('Photo markers not found in app/sw.js');
  writeFileSync(LIST, `// @ts-check
/**
 * The tool photos the app ships (app/img/tools/), by their LNF wiki file
 * name. Written by scripts/tool-photos.mjs; do not edit by hand.
 */

/** @type {ReadonlyArray<string>} */
export const TOOL_PHOTOS = Object.freeze([
${sorted.map((f) => `  '${f}',`).join('\n')}${sorted.length ? '\n' : ''}]);
`);
  const lines = sorted.map((f) => `  'img/tools/${f}',${nl}`).join('');
  writeFileSync(SW, `${sw.slice(0, start)}${head}${lines}${sw.slice(end)}`);
}

/**
 * @param {string} url
 * @returns {Promise<Buffer | null>}
 */
async function download(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'LNF-Run-Log tool-photos' } });
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * 2 ** attempt); continue; }
      if (res.status !== 200 || !/^image\//.test(res.headers.get('content-type') || '')) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      await sleep(3000 * 2 ** attempt);
    }
  }
  return null;
}

async function main() {
  const archive = process.argv.includes('--archive');
  mkdirSync(DIR, { recursive: true });
  const want = [...new Set(Object.values(TOOL_WIKI).map((t) => t.image).filter(Boolean))];
  const have = new Set(readdirSync(DIR));
  const todo = want.filter((p) => !have.has(savedName(/** @type {string} */ (p))));
  console.log(`${want.length} tool photos on the wiki; ${want.length - todo.length} already shipped; fetching ${todo.length} from ${archive ? 'the Internet Archive' : 'the wiki'}.`);
  if (!archive && todo.length) {
    // Off the UMich network each photo would take a minute or more to fail: stop now instead.
    try {
      await fetch(WIKI_HOST, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Error('The LNF wiki is not reachable from here. Use the UMich network or VPN, or run: npm run photos -- --archive');
    }
  }
  const page = todo.length ? await launch({ mobile: false }) : null;
  let saved = 0;
  try {
    for (const path of todo) {
      const file = /** @type {string} */ (path).split('/').pop() || '';
      const source = `${WIKI_HOST}${path}`;
      const bytes = await download(archive ? `https://web.archive.org/web/2026im_/${source}` : source);
      if (archive) await sleep(1500);
      if (!bytes || !page) { console.log(`  missing ${file}`); continue; }
      const type = /\.png$/i.test(file) ? 'image/png' : /\.gif$/i.test(file) ? 'image/gif' : 'image/jpeg';
      let jpeg;
      try {
        jpeg = await page.evaluate(`(async () => {
        const img = new Image();
        img.src = 'data:${type};base64,${bytes.toString('base64')}';
        await img.decode();
        const k = Math.min(1, ${MAX_EDGE} / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', ${QUALITY}).split(',')[1];
      })()`);
      } catch (err) {
        console.log(`  missing ${file} (${err instanceof Error ? err.message : err})`);
        continue;
      }
      const name = savedName(file);
      writeFileSync(join(DIR, name), Buffer.from(jpeg, 'base64'));
      saved++;
      console.log(`  saved ${name} (${Math.round(Buffer.from(jpeg, 'base64').length / 1024)} KB)`);
    }
  } finally {
    await page?.close();
  }
  const files = readdirSync(DIR).filter((f) => /\.jpg$/.test(f));
  writeLists(files);
  console.log(`Saved ${saved}. The app now ships ${files.length} tool photos (app/js/data/tool-photos.js, app/sw.js).`);
}

const isMain = () => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (isMain()) {
  if (typeof WebSocket === 'undefined' && !process.execArgv.includes('--experimental-websocket')) {
    const r = spawnSync(process.execPath, ['--experimental-websocket', ...process.argv.slice(1)], { stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
  } else if (!existsSync(DIR) && !existsSync(join(ROOT, 'app'))) {
    console.error('Run this from the project folder.');
    process.exitCode = 1;
  } else {
    main().catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
  }
}
