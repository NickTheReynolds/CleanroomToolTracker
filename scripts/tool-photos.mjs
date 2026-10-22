#!/usr/bin/env node
// @ts-check
/**
 * Ship each LNF tool's photo from the LNF wiki with the app (DECISIONS.md
 * 110). Run by hand, with the project owner's agreement; the app itself
 * never contacts the wiki. It asks the wiki's API which photo each tool page
 * shows, downloads the ones app/img/tools/ lacks, one request a second,
 * shrinks each to a small JPEG in headless Chrome or Edge, saves it under a
 * name that includes a hash of its bytes (to replace a photo, delete its
 * file and run this again), and rewrites
 * app/js/data/tool-photos.js and the photo lines of the service worker's
 * precache list. If the wiki refuses or cannot be reached, it stops: no
 * retries, no other routes.
 *
 *   npm run photos              # fetch the photos the app lacks
 *   npm run photos -- --dry-run # only list the photo each tool would get
 *
 * Needs Chrome or Edge, and a global WebSocket (Node 22+, or Node 20 with
 * --experimental-websocket).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { TOOL_WIKI, WIKI_HOST } from '../app/js/data/lnf-wiki.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'app', 'img', 'tools');
const LIST = join(ROOT, 'app', 'js', 'data', 'tool-photos.js');
const SW = join(ROOT, 'app', 'sw.js');
const API = `${WIKI_HOST}/wiki/api.php`;
const USER_AGENT = 'LNF-Run-Log tool-photos (run by hand, one request a second)';
/** Longest edge in pixels, and JPEG quality: about 30 KB a photo. */
const MAX_EDGE = 480;
const QUALITY = 0.74;
const PAUSE_MS = 1000;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** The wiki said no, or could not be reached: the run stops. */
class Refused extends Error {}

/**
 * The tool photo among a page's images. The wiki names most tool photos
 * after the tool's scheduler number ("File:10020.jpg"), next to diagrams; a
 * page without one may still show a single photo ("File:Laurell.jpg").
 * Icons (SVG) never count. Null when it is not clear which image it is.
 * @param {string[]} images file titles, as the API lists them
 * @returns {string | null}
 */
export function pickPhoto(images) {
  const raster = [...new Set(images.filter((t) => /^File:.+\.(jpe?g|png|gif)$/i.test(t)))];
  const numbered = raster.filter((t) => /^File:\d+\.[a-z]+$/i.test(t));
  if (numbered.length) return numbered.length === 1 ? numbered[0] : null;
  return raster.length === 1 ? raster[0] : null;
}

/**
 * The start of the name a photo is saved under, safe in a URL.
 * @param {string} fileTitle "File:Acid 80.png"
 * @returns {string} "Acid-80"
 */
export function savedBase(fileTitle) {
  return fileTitle.replace(/^File:/, '').replace(/\.(png|gif|jpe?g)$/i, '').replace(/[^A-Za-z0-9.-]+/g, '-');
}

/**
 * The saved name: the base and a hash of the JPEG, so a changed photo always
 * gets a new name (the service worker reuses cached photos by name).
 * @param {string} base
 * @param {Uint8Array} jpeg
 * @returns {string} "Acid-80-1a2b3c4d.jpg"
 */
export function savedName(base, jpeg) {
  return `${base}-${createHash('sha256').update(jpeg).digest('hex').slice(0, 8)}.jpg`;
}

/**
 * The photo already saved for a base name, if any.
 * @param {string} base
 * @param {string[]} files the names in app/img/tools
 * @returns {string | undefined}
 */
export function savedFile(base, files) {
  return files.find((f) => /-[0-9a-f]{8}\.jpg$/.test(f) && f.slice(0, -13) === base);
}

/**
 * The photo map module, by tool id.
 * @param {Record<string, string>} photos tool id -> saved file name
 * @returns {string}
 */
export function photoModule(photos) {
  const ids = Object.keys(photos).sort();
  return `// @ts-check
/**
 * Each LNF tool's photo from the LNF wiki, shipped with the app in
 * app/img/tools/ (DECISIONS.md 110): tool id -> file name. Written by
 * scripts/tool-photos.mjs; do not edit by hand. The photos belong to the
 * University of Michigan's LNF and are not covered by the app's license.
 */

/** @type {Readonly<Record<string, string>>} */
export const TOOL_PHOTOS = Object.freeze({
${ids.map((id) => `  '${id}': '${photos[id]}',`).join('\n')}${ids.length ? '\n' : ''}});
`;
}

/**
 * The service worker with its photo lines replaced.
 * @param {string} sw text of app/sw.js
 * @param {string[]} files saved file names
 * @returns {string}
 */
export function swWithPhotos(sw, files) {
  const nl = sw.includes('\r\n') ? '\r\n' : '\n';
  const head = `  // Tool photos (scripts/tool-photos.mjs keeps these lines).${nl}`;
  const start = sw.indexOf(head);
  const end = sw.indexOf(`  // End of tool photos.${nl}`);
  if (start < 0 || end < start) throw new Error('The tool photo markers are missing from app/sw.js');
  const lines = [...new Set(files)].sort().map((f) => `  'img/tools/${f}',${nl}`).join('');
  return `${sw.slice(0, start + head.length)}${lines}${sw.slice(end)}`;
}

/**
 * One GET to the wiki, after a pause. Anything but 200 stops the run, except
 * a 404 when `missingOk`.
 * @param {string} url
 * @param {boolean} [missingOk]
 * @returns {Promise<Response | null>}
 */
async function get(url, missingOk = false) {
  await sleep(PAUSE_MS);
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    const code = /** @type {any} */ (err)?.cause?.code;
    if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      // A gap in the server's setup, not a refusal: browsers and Windows fill it in, Node does not.
      throw new Refused('The wiki\'s server leaves out its intermediate certificate (InCommon RSA OV SSL CA 3), which Node will not fetch by '
        + 'itself. Save that certificate and its Sectigo root as a PEM file and run with NODE_EXTRA_CA_CERTS=<file>. '
        + 'Never turn certificate checks off.');
    }
    throw new Refused(`The LNF wiki could not be reached (${err instanceof Error ? err.message : err}${code ? `, ${code}` : ''}).`);
  }
  if (res.status === 404 && missingOk) return null;
  if (res.status !== 200) throw new Refused(`The LNF wiki answered HTTP ${res.status} for ${url}.`);
  return res;
}

/**
 * A query to the wiki's API, following continuation.
 * @param {Record<string, string>} params
 * @returns {Promise<any[]>} each response's query object
 */
async function query(params) {
  const out = [];
  /** @type {Record<string, string>} */
  let more = {};
  for (;;) {
    const res = /** @type {Response} */ (await get(`${API}?${new URLSearchParams({ ...params, ...more, action: 'query', format: 'json', formatversion: '2' })}`));
    const body = await res.json();
    if (body.error) throw new Refused(`The wiki's API said: ${body.error.info || body.error.code}`);
    if (body.query) out.push(body.query);
    if (!body.continue) return out;
    more = body.continue;
  }
}

/** @template T @param {T[]} a @param {number} n @returns {T[][]} */
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * Which photo each tool page shows.
 * @param {string[]} pages page titles
 * @returns {Promise<Map<string, string[]>>} page title -> its file titles
 */
async function pageImages(pages) {
  /** @type {Map<string, string[]>} */
  const images = new Map(pages.map((p) => [p, []]));
  for (const batch of chunks(pages, 50)) {
    for (const q of await query({ titles: batch.join('|'), prop: 'images', imlimit: 'max', redirects: '1' })) {
      // The API answers under normalised or redirected titles: map them back.
      /** @type {Map<string, string>} */
      const back = new Map();
      for (const n of [...(q.normalized || []), ...(q.redirects || [])]) back.set(n.to, back.get(n.from) || n.from);
      for (const p of q.pages || []) {
        const title = back.get(p.title) || p.title;
        images.get(title)?.push(...(p.images || []).map((/** @type {any} */ i) => i.title));
      }
    }
  }
  return images;
}

/**
 * Where each photo file lives.
 * @param {string[]} files file titles
 * @returns {Promise<Map<string, string>>} file title -> address
 */
async function fileUrls(files) {
  /** @type {Map<string, string>} */
  const urls = new Map();
  for (const batch of chunks(files, 50)) {
    for (const q of await query({ titles: batch.join('|'), prop: 'imageinfo', iiprop: 'url' })) {
      for (const p of q.pages || []) if (p.imageinfo && p.imageinfo[0]) urls.set(p.title, p.imageinfo[0].url);
    }
  }
  return urls;
}

/**
 * A small JPEG of the image, made by the browser.
 * @param {import('./cdp.mjs').Page} page
 * @param {Buffer} bytes
 * @param {string} type
 * @returns {Promise<Buffer>}
 */
async function shrink(page, bytes, type) {
  const b64 = await page.evaluate(`(async () => {
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
  return Buffer.from(b64, 'base64');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const tools = Object.entries(TOOL_WIKI);
  const images = await pageImages([...new Set(tools.map(([, w]) => w.page))]);
  /** @type {Record<string, string>} tool id -> file title */
  const chosen = {};
  for (const [id, w] of tools) {
    const pick = pickPhoto(images.get(w.page) || []);
    if (pick) chosen[id] = pick;
    else console.log(`  no single photo on "${w.page}"${(images.get(w.page) || []).length ? ` (${(images.get(w.page) || []).join(', ')})` : ''}`);
  }
  const wanted = [...new Set(Object.values(chosen))];
  console.log(`${tools.length} tools; ${Object.keys(chosen).length} have a photo (${wanted.length} files).`);
  if (dryRun) return;
  mkdirSync(DIR, { recursive: true });
  /** @type {Map<string, string>} wiki file title -> saved name */
  const saved = new Map();
  for (const f of wanted) {
    const have = savedFile(savedBase(f), readdirSync(DIR));
    if (have) saved.set(f, have);
  }
  const todo = wanted.filter((f) => !saved.has(f));
  console.log(`${saved.size} already shipped; downloading ${todo.length}.`);
  const urls = todo.length ? await fileUrls(todo) : new Map();
  const page = todo.length ? await launch({ mobile: false }) : null;
  let refused = null;
  try {
    for (const file of todo) {
      const url = urls.get(file);
      if (!url || !page) { console.log(`  missing ${file}`); continue; }
      const res = await get(url, true);
      const type = res ? res.headers.get('content-type') || '' : '';
      if (!res || !/^image\/(jpeg|png|gif)$/.test(type)) { console.log(`  missing ${file}`); continue; }
      const jpeg = await shrink(page, Buffer.from(await res.arrayBuffer()), type);
      const name = savedName(savedBase(file), jpeg);
      writeFileSync(join(DIR, name), jpeg);
      saved.set(file, name);
      console.log(`  saved ${name} (${Math.round(jpeg.length / 1024)} KB)`);
    }
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    refused = err;
  } finally {
    await page?.close();
  }
  // Ship only what is on disk, so a stopped run still leaves a consistent app.
  /** @type {Record<string, string>} */
  const photos = {};
  for (const [id, file] of Object.entries(chosen)) {
    const name = saved.get(file);
    if (name && existsSync(join(DIR, name))) photos[id] = name;
  }
  writeFileSync(LIST, photoModule(photos));
  writeFileSync(SW, swWithPhotos(readFileSync(SW, 'utf8'), Object.values(photos)));
  const unused = readdirSync(DIR).filter((f) => !Object.values(photos).includes(f));
  console.log(`The app ships ${Object.keys(photos).length} tool photos (${new Set(Object.values(photos)).size} files).`);
  if (unused.length) console.log(`Not used by any tool (delete them): ${unused.join(', ')}`);
  if (refused) throw refused;
}

const isMain = () => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (isMain()) {
  if (typeof WebSocket === 'undefined' && !process.execArgv.includes('--experimental-websocket')) {
    const r = spawnSync(process.execPath, ['--experimental-websocket', ...process.argv.slice(1)], { stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
  } else {
    main().catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      if (err instanceof Refused) console.error('Stopped without retrying. Photos saved so far are listed in the app.');
      process.exitCode = 1;
    });
  }
}
