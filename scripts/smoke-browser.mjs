#!/usr/bin/env node
// @ts-check
/**
 * Browser smoke test (spec Section 15): in headless Chrome or Edge, load the
 * app, log a run, add pre and post measurements, run a lookup, export a
 * backup, then stop the server and reload offline. Uses Node built-ins
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
import { launch } from './cdp.mjs';
import { makeServer } from '../serve.mjs';

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
  // Accessibility: every visible form control needs a label or an aria name.
  const checkLabels = async (/** @type {string} */ screen) => {
    const bad = await page.evaluate(`[...document.querySelectorAll('input, select, textarea')]
      .filter((el) => el.type !== 'hidden' && el.getAttribute('aria-hidden') !== 'true')
      .filter((el) => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
      .map((el) => el.outerHTML.slice(0, 90))`);
    for (const b of bad) unlabeled.push(`${screen}: ${b}`);
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
    await t(`__t.tile('ICP etcher')`);
    await page.waitFor(`document.querySelector('.field[data-key="icpPower"]')`);
    await t(`__t.field('icpPower', 400) && __t.field('pressure', 10) && __t.field('chf3', 50) && __t.field('o2', 0)`);
    await t(`__t.type('.field[data-key="time"] .dur-min', '5') && __t.type('.field[data-key="time"] .dur-sec', '0')`);
    await t(`[...document.querySelectorAll('.pick-btn')].find((b) => b.textContent.includes('SiO2 (thermal)')).click()`);
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
    await page.waitFor(`document.querySelectorAll('.tile').length > 3`);
    await t(`__t.tile('ICP etcher')`);
    await page.waitFor(`__t.btn('Find similar runs')`);
    await t(`__t.click('Find similar runs')`);
    await page.waitFor(`location.hash.startsWith('#/results') && document.querySelector('.summary-card .headline')`);
    const headline = await t(`document.querySelector('.summary-card .headline').textContent`);
    if (headline.trim() !== '85 nm/min') throw new Error(`headline was ${headline}`);
    await snap('lookup-results');
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
    if (!/^lnf-runlog-backup-\d{4}-\d{2}-\d{2}\.json$/.test(file)) throw new Error(`unexpected file name ${file}`);
  });
  await step('works offline after the server stops', async () => {
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
      ['#/settings/tools', '.list'], ['#/event', '.tiles'], ['#/capture', '.tiles'],
    ]) {
      await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await page.waitFor(`document.querySelector(${JSON.stringify(ready)})`, 10000);
      await checkLabels(hash);
    }
    if (unlabeled.length) throw new Error(`unlabelled controls:\n${unlabeled.join('\n')}`);
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
