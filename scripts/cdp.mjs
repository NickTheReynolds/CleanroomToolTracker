// @ts-check
/**
 * Minimal Chrome DevTools Protocol client for the browser smoke test:
 * launch headless Chrome or Edge, open a page, evaluate scripts, take
 * screenshots. Node built-ins only (uses the global WebSocket, which Node 22
 * provides; Node 20 needs --experimental-websocket).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

/** @returns {string | null} path of an installed Chromium-based browser */
export function findBrowser() {
  return CANDIDATES.find((p) => p && existsSync(p)) || null;
}

/**
 * @typedef {Object} Page
 * @property {(method: string, params?: object) => Promise<any>} send
 * @property {(expression: string) => Promise<any>} evaluate value of an expression (promises awaited)
 * @property {(event: string, fn: (params: any) => void) => void} on
 * @property {(pred: string, timeoutMs?: number) => Promise<any>} waitFor poll an expression until truthy
 * @property {() => Promise<Buffer>} screenshot PNG of the viewport
 * @property {(url: string) => Promise<void>} goto
 * @property {() => Promise<void>} reload full page reload (waits for load)
 * @property {() => Promise<void>} close
 */

/**
 * Launch a headless browser and open one page.
 * @param {{width?: number, height?: number, scale?: number, mobile?: boolean, dark?: boolean}} [opts]
 * @returns {Promise<Page>}
 */
export async function launch(opts = {}) {
  if (typeof WebSocket === 'undefined') {
    throw new Error('This Node has no global WebSocket. Use Node 22+, or Node 20 with --experimental-websocket.');
  }
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome or Edge found. Set CHROME_PATH.');
  const profile = mkdtempSync(join(tmpdir(), 'lnf-cdp-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Browser did not start')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`Browser exited (${code})`)));
  });
  const ws = new WebSocket(/** @type {string} */ (wsUrl));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  /** @type {Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>} */
  const waiting = new Map();
  /** @type {Map<string, ((p: any) => void)[]>} */
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && waiting.has(msg.id)) {
      const w = /** @type {any} */ (waiting.get(msg.id));
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(`${msg.error.message} ${msg.error.data || ''}`));
      else w.resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    }
  };
  /**
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   */
  const raw = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await raw('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true });
  /** @type {(method: string, params?: object) => Promise<any>} */
  const send = (method, params) => raw(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: opts.width || 390, height: opts.height || 844, deviceScaleFactor: opts.scale || 2, mobile: opts.mobile !== false,
  });
  if (opts.mobile !== false) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (opts.dark) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  }
  /** @type {Page} */
  const page = {
    send,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      /** @type {any[]} */ (listeners.get(event)).push(fn);
    },
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error(`Page error: ${d.exception?.description || d.text}`);
      }
      return r.result.value;
    },
    async waitFor(pred, timeoutMs = 10000) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const v = await page.evaluate(`(() => { try { return (${pred}); } catch { return false; } })()`);
        if (v) return v;
        if (Date.now() > end) throw new Error(`Timed out waiting for: ${pred}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    },
    async goto(url) {
      const loaded = new Promise((r) => page.on('Page.loadEventFired', r));
      await send('Page.navigate', { url });
      await loaded;
    },
    async reload() {
      const loaded = new Promise((r) => page.on('Page.loadEventFired', r));
      await send('Page.reload', {});
      await loaded;
    },
    async close() {
      try { await raw('Browser.close'); } catch { /* already closed */ }
      ws.close();
      proc.kill();
      await new Promise((r) => setTimeout(r, 300));
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
    },
  };
  return page;
}
