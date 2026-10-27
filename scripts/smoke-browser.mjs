#!/usr/bin/env node
// @ts-check
/**
 * Browser smoke test (spec Section 15): in headless Chrome or Edge, load the
 * app, log a run, add pre and post measurements, run a lookup, fill a run
 * form from an LNF wiki recipe, follow a project's wafers through a run and
 * file the project in a folder, export a backup, then stop the server and
 * reload offline. Uses Node built-ins
 * only; needs a Chromium-based browser (set CHROME_PATH if it is not found)
 * and a global WebSocket (Node 22+, or Node 20 with --experimental-websocket).
 *
 *   npm run smoke
 *   node scripts/smoke-browser.mjs --shots out-dir   # also save screenshots
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, BLOCKED_HOSTS } from './cdp.mjs';
import { makeServer } from '../serve.mjs';
import { LNF_TOOLS } from '../app/js/data/seed-lnf.js';
import { RECIPES } from '../app/js/data/lnf-recipes-etch.js';
import { TOOL_PHOTOS } from '../app/js/data/tool-photos.js';

/** The seeded ICP etcher the test logs a run on, and its first gas line. */
const ICP = LNF_TOOLS.find((t) => t[3] === 'icp-etch') || LNF_TOOLS[0];
const TOOL_NAME = ICP[2];
const GAS_KEY = ICP[4].length ? ICP[4][0].normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toLowerCase() : 'cf4';
/** An LNF recipe of that tool whose main step sets the ICP power (not to the 400 W logged below), and that power. */
const RECIPE = RECIPES.find((r) => r.tool === ICP[0] && r.main >= 0
  && r.steps[r.main].values.some((v) => v.k === 'icpPower' && typeof v.v === 'number' && v.v !== 400));
const RECIPE_ICP = RECIPE ? RECIPE.steps[RECIPE.main].values.find((v) => v.k === 'icpPower')?.v : null;

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Page-side helpers: find and tap buttons by visible text, type into inputs. */
const HELPERS = `window.__t = window.__t || {
  btn(text) { return [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === text || b.getAttribute('aria-label') === text); },
  click(text) { const b = this.btn(text); if (!b) throw new Error('No button "' + text + '"'); b.click(); return true; },
  tile(text) { const t = [...document.querySelectorAll('.tile')].find((b) => b.textContent.includes(text)); if (!t) throw new Error('No tile "' + text + '"'); t.click(); return true; },
  type(sel, value) { const el = document.querySelector(sel); if (!el) throw new Error('No input ' + sel); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); return true; },
  field(key, value) { return this.type('.field[data-key="' + key + '"] .stepper-input', String(value)); },
  labelled(text, value) {
    const l = [...document.querySelectorAll('#view label, dialog label')].find((x) => x.textContent.trim() === text);
    if (!l || !l.control) throw new Error('No field "' + text + '"');
    l.control.value = value;
    l.control.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  text() { return document.querySelector('#view').innerText; },
};`;

async function main() {
  const server = makeServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}/`;
  const downloads = mkdtempSync(join(tmpdir(), 'lnf-smoke-dl-'));
  const page = await launch();
  // The app must never contact the LNF wiki on its own (only links the person taps go there).
  // launch() makes the wiki unreachable, and every page notes any request it still tries. (DevTools
  // request interception would do it too, but it makes the page bypass its service worker.)
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__wikiTries = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          try { if (${JSON.stringify(BLOCKED_HOSTS)}.includes(new URL(e.name).hostname)) window.__wikiTries.push(e.name); } catch { /* not a URL */ }
        }
      }).observe({ type: 'resource', buffered: true });`,
  });
  /** @type {string[]} */
  const wikiRequests = [];
  const collectWikiTries = async () => { wikiRequests.push(...await page.evaluate('window.__wikiTries || []')); };
  /** @type {string[]} */
  const errors = [];
  page.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
  page.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') errors.push(p.args.map((/** @type {any} */ a) => a.value ?? a.description).join(' '));
  });
  await page.sendBrowser('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  /** @param {string} expr */
  const t = (expr) => page.evaluate(`(async () => { ${HELPERS}; return (${expr}); })()`);
  let shot = 0;
  /** @type {string[]} */
  const unlabeled = [];
  /** @type {string[]} */
  const noHelp = [];
  // Accessibility: every visible form control needs a label or an aria name,
  // and every visible field label its "i" button.
  const checkLabels = async (/** @type {string} */ screen) => {
    const bad = await page.evaluate(`[...document.querySelectorAll('input, select, textarea')]
      .filter((el) => el.type !== 'hidden' && el.getAttribute('aria-hidden') !== 'true')
      .filter((el) => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
      .map((el) => el.outerHTML.slice(0, 90))`);
    for (const b of bad) unlabeled.push(`${screen}: ${b}`);
    const helpless = await page.evaluate(`[...document.querySelectorAll(['#view', 'dialog.sheet']
      .flatMap((root) => ['.field > .label', '.field > .field-head .label', '.seg > .label', '.seg > .field-head .label'].map((s) => root + ' ' + s))
      .join(', '))]
      .filter((l) => l.offsetParent !== null && !l.classList.contains('visually-hidden'))
      .filter((l) => !l.closest('.label-help')?.querySelector('.help-btn'))
      .map((l) => l.textContent.trim().slice(0, 60))`);
    for (const b of helpless) noHelp.push(`${screen}: ${b}`);
  };
  const snap = async (/** @type {string} */ name) => {
    await checkLabels(name);
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    writeFileSync(join(shotsDir, `${String(++shot).padStart(2, '0')}-${name}.png`), await page.screenshot());
  };
  let failed = false;
  /**
   * @param {string} name
   * @param {() => Promise<void>} fn
   */
  const step = async (name, fn) => {
    if (failed) return;
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failed = true;
      console.log(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
      await snap('failure').catch(() => {});
    }
  };
  let runHash = '';
  console.log(`Smoke test against ${base}`);
  await step('app loads and the service worker takes control', async () => {
    await page.goto(base);
    await page.waitFor(`document.querySelector('.home-grid')`);
    await page.waitFor(`navigator.serviceWorker.ready.then(() => true)`, 20000);
    await page.reload();
    await page.waitFor(`!!navigator.serviceWorker.controller && document.querySelector('.home-grid')`, 15000);
    await snap('home');
  });
  await step('log a run', async () => {
    await t(`__t.click('Log run')`);
    await page.waitFor(`document.querySelectorAll('.tile').length > 3`);
    await t(`__t.tile(${JSON.stringify(TOOL_NAME)})`);
    await page.waitFor(`document.querySelector('.field[data-key="icpPower"]')`);
    await t(`__t.field('icpPower', 400) && __t.field('pressure', 10) && __t.field(${JSON.stringify(GAS_KEY)}, 50)`);
    await t(`__t.type('.field[data-key="time"] .dur-min', '5') && __t.type('.field[data-key="time"] .dur-sec', '0')`);
    await snap('log-form');
    await t(`__t.click('Save')`);
    await page.waitFor(`location.hash.startsWith('#/run/') && document.querySelector('.section')`);
    runHash = await t('location.hash');
  });
  /** @param {number[]} values */
  const measure = async (values) => {
    await t(`__t.click('Measure')`);
    await page.waitFor(`document.querySelectorAll('.point-row').length === ${values.length}`);
    await checkLabels('measurement');
    for (let i = 0; i < values.length; i++) await t(`__t.type('.point-row:nth-child(${i + 1}) .stepper-input', '${values[i]}')`);
    await t(`__t.click('Save')`);
    await page.waitFor(`location.hash === ${JSON.stringify(runHash)} && document.querySelector('.section')`);
  };
  await step('add pre and post measurements; the etch rate is derived', async () => {
    await measure([1000, 1002, 998, 1001, 999]);
    await measure([575, 577, 573, 576, 574]);
    await page.waitFor(`[...document.querySelectorAll('.big-value')].some((e) => e.textContent.trim() === '85 nm/min')`);
    await snap('run-derived');
    await t(`__t.click('Mark complete')`);
    await page.waitFor(`[...document.querySelectorAll('.badge')].some((b) => b.textContent.includes('Complete'))`);
  });
  await step('run a lookup', async () => {
    await page.evaluate(`location.hash = '#/lookup'`);
    await page.waitFor(`[...document.querySelectorAll('.tile')].some((x) => x.textContent.includes(${JSON.stringify(TOOL_NAME)}))`);
    await t(`__t.tile(${JSON.stringify(TOOL_NAME)})`);
    await page.waitFor(`__t.btn('Find similar runs')`);
    await checkLabels('lookup-form');
    await t(`__t.click('Find similar runs')`);
    await page.waitFor(`location.hash.startsWith('#/results') && document.querySelector('.summary-card .headline')`);
    const headline = await t(`document.querySelector('.summary-card .headline').textContent`);
    if (headline.trim() !== '85 nm/min') throw new Error(`headline was ${headline}`);
    await snap('lookup-results');
  });
  await step('fill a run form from an LNF wiki recipe', async () => {
    if (!RECIPE) throw new Error(`no LNF recipe that sets the ICP power on ${TOOL_NAME}`);
    await page.evaluate(`location.hash = '#/log'`);
    // Pickers now show the tools used lately first, so wait for this tool's tile.
    await page.waitFor(`[...document.querySelectorAll('.tile')].some((x) => x.textContent.includes(${JSON.stringify(TOOL_NAME)}))`);
    await t(`__t.tile(${JSON.stringify(TOOL_NAME)})`);
    const open = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('LNF recipes'))`;
    await page.waitFor(`!!${open} && document.querySelector('.field[data-key="icpPower"] .stepper-input').value === '400'`);
    await t(`${open}.click()`);
    await page.waitFor(`document.querySelector('dialog.sheet .row')`);
    await checkLabels('recipe-list');
    await t(`[...document.querySelectorAll('dialog.sheet .row')].find((r) => r.querySelector('.row-title').textContent === ${JSON.stringify(RECIPE.name)}).click()`);
    await page.waitFor(`document.querySelector('dialog.sheet .recipe-detail .recipe-fills')`);
    await snap('recipe-detail');
    await t(`document.querySelector('dialog.sheet .recipe-detail .sheet-actions .btn-primary').click()`);
    await page.waitFor(`!document.querySelector('dialog.sheet')
      && document.querySelector('.field[data-key="icpPower"] .stepper-input').value === ${JSON.stringify(String(RECIPE_ICP))}`);
    const name = await t(`[...document.querySelectorAll('#view label')].find((l) => l.textContent === 'Recipe name').control.value`);
    if (name !== RECIPE.name) throw new Error(`the recipe field says ${name}`);
    await snap('log-form-recipe');
    await page.evaluate(`location.hash = '#/tool/${ICP[0]}'`);
    await page.waitFor(`[...document.querySelectorAll('.section-title')].some((h) => h.textContent.startsWith('LNF recipes'))`);
    await checkLabels('tool-detail');
  });
  await step('tool photos come with the app and show on the tool card and the tool\'s page', async () => {
    if (!TOOL_PHOTOS[ICP[0]]) throw new Error(`${TOOL_NAME} has no photo in app/js/data/tool-photos.js`);
    const loaded = (/** @type {string} */ sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})]
      .some((i) => i.complete && i.naturalWidth > 0 && new URL(i.src).origin === location.origin)`;
    await page.waitFor(loaded('.tool-hero-img'));
    await snap('tool-photo-page');
    await page.evaluate(`location.hash = '#/log'`);
    await page.waitFor(`[...document.querySelectorAll('.tile')].some((x) => x.textContent.includes(${JSON.stringify(TOOL_NAME)}))`);
    await t(`__t.tile(${JSON.stringify(TOOL_NAME)})`);
    await page.waitFor(loaded('.tool-card .tool-photo'));
    await t(`document.querySelector('.tool-photo-btn').click()`);
    await page.waitFor(loaded('dialog.sheet .tool-photo-large'));
    await snap('tool-photo-large');
    await t(`document.querySelector('dialog.sheet').close()`);
  });
  await step('a project follows its wafers through a run, and moves into a folder', async () => {
    await page.evaluate(`location.hash = '#/project/new'`);
    await page.waitFor(`__t.btn('Add wafers')`);
    await t(`__t.labelled('Name', 'Smoke batch')`);
    // Two wafers of an LNF store type: they replace the new project's untouched W1.
    await t(`__t.click('Add wafers')`);
    await page.waitFor(`document.querySelector('dialog.sheet [role="radiogroup"] .row')`);
    await t(`[...document.querySelectorAll('dialog.sheet .row')].find((r) => r.textContent.includes('Double Side Polished')).click()`);
    await t(`__t.click('2')`);
    await checkLabels('add-wafers');
    await t(`__t.click('Add 2 wafers')`);
    await page.waitFor(`!document.querySelector('dialog.sheet') && document.querySelectorAll('.wafer-row').length === 2
      && __t.btn('W1 type: Si · 100 mm · p · DSP') && __t.btn('W2 type: Si · 100 mm · p · DSP')`);
    await t(`__t.click('Add step')`);
    await page.waitFor(`__t.btn('Choose a tool (optional)')`);
    await t(`__t.labelled('What happens', 'Etch the oxide')`);
    await t(`__t.click('Choose a tool (optional)')`);
    await page.waitFor(`document.querySelector('dialog.sheet .tile')`);
    await t(`__t.tile(${JSON.stringify(TOOL_NAME)})`);
    await page.waitFor(`!document.querySelector('dialog.sheet') && __t.btn(${JSON.stringify(TOOL_NAME)})`);
    // A furnace step without the pre-furnace clean before it: the plan's checks say so, and fix it in one tap.
    await t(`__t.click('Add step')`);
    await page.waitFor(`__t.btn('Choose a tool (optional)')`);
    await t(`__t.click('Choose a tool (optional)')`);
    await page.waitFor(`document.querySelector('dialog.sheet .tile')`);
    await t(`__t.type('dialog.sheet input[type=search]', 'S3T2')`);
    await page.waitFor(`[...document.querySelectorAll('dialog.sheet .tile')].some((x) => x.textContent.includes('Tempress S3T2'))`);
    await t(`__t.tile('Tempress S3T2 - Wet Oxide')`);
    await page.waitFor(`document.querySelector('.compat-note.note-stop') && __t.btn('Add the PFC Bench 01 clean before this step')`, 10000);
    await snap('project-edit-checks');
    await t(`__t.click('Add the PFC Bench 01 clean before this step')`);
    await page.waitFor(`document.querySelectorAll('.plan-step').length === 3 && !document.querySelector('.compat-note')
      && document.querySelector('#plan-checks').textContent.startsWith('No notes')`, 10000);
    await checkLabels('project-edit');
    await snap('project-edit');
    await t(`__t.click('Save')`);
    await page.waitFor(`location.hash.startsWith('#/project/') && __t.btn('Log this step')`);
    await t(`__t.click('Log this step')`);
    await page.waitFor(`[...document.querySelectorAll('.project-links .pick-btn[aria-pressed="true"]')].some((b) => b.textContent.includes('Smoke batch'))`);
    await checkLabels('log-form-project');
    await t(`__t.click('Save')`);
    await page.waitFor(`location.hash.startsWith('#/run/') && document.querySelector('.project-open')`);
    await t(`document.querySelector('.project-open').click()`);
    await page.waitFor(`document.querySelectorAll('.traveler-no').length === 1 && __t.text().includes('In progress')`);
    await snap('project-detail');
    await page.evaluate(`location.hash = '#/projects'`);
    await page.waitFor(`__t.btn('New folder')`);
    await t(`__t.click('New folder')`);
    await page.waitFor(`document.querySelector('dialog.sheet input')`);
    await t(`__t.labelled('Folder name', 'Smoke folder')`);
    await t(`__t.click('Create folder')`);
    await page.waitFor(`!document.querySelector('dialog.sheet') && __t.btn('Select')`);
    await t(`__t.click('Select')`);
    await page.waitFor(`document.querySelector('[role="checkbox"]')`);
    await t(`[...document.querySelectorAll('[role="checkbox"]')].find((b) => b.textContent.includes('Smoke batch')).click()`);
    await t(`__t.click('Move (1)')`);
    await page.waitFor(`document.querySelector('dialog.sheet .folder-list')`);
    await t(`__t.click('Smoke folder')`);
    await page.waitFor(`[...document.querySelectorAll('a.row')].some((r) => r.textContent.includes('Smoke folder') && r.textContent.includes('1 project (1 active)'))`);
    await snap('projects-folders');
  });
  await step('export a backup file', async () => {
    await page.evaluate(`location.hash = '#/settings/data'`);
    await page.waitFor(`__t.btn('Prepare backup')`);
    await t(`__t.click('Prepare backup')`);
    await page.waitFor(`__t.btn('Download')`, 15000);
    await t(`__t.click('Download')`);
    let file = '';
    for (let i = 0; i < 50 && !file; i++) {
      await sleep(200);
      file = readdirSync(downloads).find((f) => f.endsWith('.json')) || '';
    }
    if (!file) throw new Error('no backup file was downloaded');
    const backup = JSON.parse(readFileSync(join(downloads, file), 'utf8'));
    if (backup.format !== 'lnf-runlog' || !backup.runs.some((/** @type {any} */ r) => `#/run/${r.id}` === runHash)) {
      throw new Error('the backup does not contain the logged run');
    }
    const folder = (backup.folders || []).find((/** @type {any} */ x) => x.name === 'Smoke folder');
    if (!folder || !(backup.projects || []).some((/** @type {any} */ p) => p.name === 'Smoke batch' && p.folderId === folder.id)) {
      throw new Error('the backup does not contain the project in its folder');
    }
    if (!/^lnf-runlog-backup-\d{4}-\d{2}-\d{2}\.json$/.test(file)) throw new Error(`unexpected file name ${file}`);
  });
  await step('export everything as Excel, CSV and PDF', async () => {
    /** First bytes each format must start with. */
    const MAGIC = /** @type {Record<string, number[]>} */ ({ xlsx: [0x50, 0x4b, 3, 4], csv: [0xef, 0xbb, 0xbf], pdf: [0x25, 0x50, 0x44, 0x46] });
    for (const [label, ext] of [['Excel', 'xlsx'], ['CSV', 'csv'], ['PDF', 'pdf']]) {
      await t(`[...document.querySelectorAll('.seg-btn')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
      await t(`__t.click('Prepare the export')`);
      await page.waitFor(`[...document.querySelectorAll('.card strong')].some((s) => s.textContent.endsWith('.${ext}'))`, 15000);
      await t(`[...document.querySelectorAll('.card')].find((c) => c.textContent.includes('.${ext}')).querySelector('button:last-of-type').click()`);
      let file = '';
      for (let i = 0; i < 50 && !file; i++) {
        await sleep(200);
        file = readdirSync(downloads).find((f) => f.startsWith('lnf-runlog-all-') && f.endsWith(`.${ext}`)) || '';
      }
      if (!file) throw new Error(`no ${ext} file was downloaded`);
      const head = [...readFileSync(join(downloads, file)).subarray(0, 4)];
      if (MAGIC[ext].some((b, i) => head[i] !== b)) throw new Error(`${file} does not look like a ${label} file`);
    }
  });
  await step('works offline after the server stops', async () => {
    await collectWikiTries(); // the reload below starts a new page
    await new Promise((r) => { server.closeAllConnections?.(); server.close(() => r(undefined)); });
    await page.evaluate(`location.hash = ${JSON.stringify(runHash)}`);
    await page.reload();
    await page.waitFor(`[...document.querySelectorAll('.big-value')].some((e) => e.textContent.trim() === '85 nm/min')`, 15000);
    await page.evaluate(`location.hash = '#/results'`);
    await page.waitFor(`document.querySelector('.summary-card .headline')`, 15000);
    await snap('offline-results');
  });
  await step('other screens render with every control labelled', async () => {
    for (const [hash, ready] of [
      ['#/', '.home-grid'], ['#/open', '.view'], ['#/history', '.view .list, .view .empty'], ['#/settings', '.section'],
      ['#/settings/tools', '.list'], ['#/settings/materials', '.list'], ['#/settings/sync', '.section'],
      ['#/settings/data', '.section'], ['#/install', '.section'], [`#/settings/tool/${ICP[0]}`, '.section'],
      [`#/template/${ICP[1]}`, '.section'], ['#/event', '.tiles'], ['#/capture', '.tiles'],
      ['#/projects', '.view .list'], ['#/project/new', '.view .field'], ['#/settings/my-tools', '.list'], [`#/tool/${ICP[0]}`, '.section'],
      ['#/settings/wafer-types', '.view .list'], ['#/settings/wafer-type/new', '.view .field'],
      ['#/settings/wafer-type/new?from=lnf-store%2Fmask-plate-5in-master-low-bow', '.view .field'],
    ]) {
      await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await page.waitFor(`document.querySelector(${JSON.stringify(ready)})`, 10000);
      await checkLabels(hash);
    }
    if (unlabeled.length) throw new Error(`unlabelled controls:\n${unlabeled.join('\n')}`);
    if (noHelp.length) throw new Error(`field labels without an "i" button:\n${noHelp.join('\n')}`);
  });
  await step('an "i" button opens and closes its note', async () => {
    await page.evaluate(`location.hash = '#/settings'`);
    await page.waitFor(`document.querySelector('.help-btn[aria-label="About Half-life"]')`, 10000);
    const res = await t(`(() => {
      const b = document.querySelector('.help-btn[aria-label="About Half-life"]');
      const advanced = b.closest('details'); // Lookup tuning sits under Settings → Advanced
      if (advanced) advanced.open = true;
      const note = document.getElementById(b.getAttribute('aria-controls'));
      const shut = note.hidden && b.getAttribute('aria-expanded') === 'false';
      b.click();
      const open = !note.hidden && b.getAttribute('aria-expanded') === 'true' && note.innerText.includes('half as much');
      b.click();
      return { shut, open, closed: note.hidden && b.getAttribute('aria-expanded') === 'false' };
    })()`);
    if (!res.shut || !res.open || !res.closed) throw new Error(`note states ${JSON.stringify(res)}`);
  });
  await step('the app never contacts the LNF wiki by itself', async () => {
    await collectWikiTries();
    if (wikiRequests.length) throw new Error(`the page asked the wiki for:\n${[...new Set(wikiRequests)].join('\n')}`);
  });
  await step('no errors in the page', async () => {
    if (errors.length) throw new Error(errors.join('\n'));
  });
  await page.close();
  server.close();
  rmSync(downloads, { recursive: true, force: true });
  console.log(failed ? 'Smoke test FAILED' : 'Smoke test passed');
  process.exitCode = failed ? 1 : 0;
}

const isMain = () => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (isMain()) {
  if (typeof WebSocket === 'undefined' && !process.execArgv.includes('--experimental-websocket')) {
    // Node 20 has a WebSocket client behind a flag: re-run with it.
    const r = spawnSync(process.execPath, ['--experimental-websocket', ...process.argv.slice(1)], { stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
  } else {
    main().catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
  }
}
