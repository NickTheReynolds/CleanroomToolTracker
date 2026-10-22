// @ts-check
/**
 * Minimal Chrome DevTools Protocol client for the browser smoke test:
 * launch headless Chrome or Edge (or connect to a running browser, such as
 * the WebView2 desktop app), open a page, evaluate scripts, take
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
 * @property {(method: string, params?: object) => Promise<any>} send command to this page
 * @property {(method: string, params?: object) => Promise<any>} sendBrowser browser-level command (Browser.*)
 * @property {(expression: string) => Promise<any>} evaluate value of an expression (promises awaited)
 * @property {(event: string, fn: (params: any) => void) => void} on
 * @property {(pred: string, timeoutMs?: number) => Promise<any>} waitFor poll an expression until truthy
 * @property {() => Promise<Buffer>} screenshot PNG of the viewport
 * @property {(url: string) => Promise<void>} goto
 * @property {() => Promise<void>} reload full page reload (waits for load)
 * @property {() => Promise<void>} close
 */

const NO_WEBSOCKET = 'This Node has no global WebSocket. Use Node 22+, or Node 20 with --experimental-websocket.';

/**
 * Hosts a test browser must never reach. Nothing automated may download from
 * the LNF wiki without the owner's say-so (it has had security problems), and
 * the app's tool card would otherwise load tool photos from it in every test.
 */
export const BLOCKED_HOSTS = Object.freeze(['lnf-wiki.eecs.umich.edu']);
const RULES = BLOCKED_HOSTS.map((host) => `MAP ${host} ~NOTFOUND`).join(', ');
/** Makes BLOCKED_HOSTS unresolvable for the whole browser (pages and service workers), as one argument. */
export const BLOCK_HOSTS_ARG = `--host-resolver-rules=${RULES}`;
/** The same switch for a command-line string, such as WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS. */
export const BLOCK_HOSTS_SWITCH = `--host-resolver-rules="${RULES}"`;

/**
 * Launch a headless browser and open one page.
 * @param {{width?: number, height?: number, scale?: number, mobile?: boolean, dark?: boolean}} [opts]
 * @returns {Promise<Page>}
 */
export async function launch(opts = {}) {
  if (typeof WebSocket === 'undefined') throw new Error(NO_WEBSOCKET);
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome or Edge found. Set CHROME_PATH.');
  const profile = mkdtempSync(join(tmpdir(), 'lnf-cdp-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', BLOCK_HOSTS_ARG, 'about:blank',
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
  const page = await connect(/** @type {string} */ (wsUrl), { newPage: true });
  const { send } = page;
  await send('Emulation.setDeviceMetricsOverride', {
    width: opts.width || 390, height: opts.height || 844, deviceScaleFactor: opts.scale || 2, mobile: opts.mobile !== false,
  });
  if (opts.mobile !== false) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (opts.dark) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  }
  const disconnect = page.close;
  page.close = async () => {
    const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
    try { await page.sendBrowser('Browser.close'); } catch { /* already closed */ }
    await disconnect();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    proc.kill();
    // The browser's helper processes let go of the profile a moment after it exits.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* still locked */ }
  };
  return page;
}

/**
 * Connect to a running browser's DevTools endpoint and attach to a page:
 * the first open page, or a new about:blank one. For a browser or WebView2
 * app started with --remote-debugging-port=<port>, wsUrl is the
 * webSocketDebuggerUrl from http://127.0.0.1:<port>/json/version. The
 * returned page's close() only disconnects; the browser keeps running.
 * @param {string} wsUrl browser-level DevTools WebSocket URL
 * @param {{newPage?: boolean}} [opts] newPage: open a new about:blank page instead of attaching to an open one
 * @returns {Promise<Page>}
 */
export async function connect(wsUrl, opts = {}) {
  if (typeof WebSocket === 'undefined') throw new Error(NO_WEBSOCKET);
  const ws = new WebSocket(wsUrl);
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
  let targetId;
  if (opts.newPage) {
    ({ targetId } = await raw('Target.createTarget', { url: 'about:blank' }));
  } else {
    const { targetInfos } = await raw('Target.getTargets');
    const open = targetInfos.find((/** @type {any} */ t) => t.type === 'page');
    if (!open) {
      ws.close();
      throw new Error('The browser has no open page to attach to.');
    }
    targetId = open.targetId;
  }
  const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true });
  /** @type {(method: string, params?: object) => Promise<any>} */
  const send = (method, params) => raw(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  /** @type {Page} */
  const page = {
    send,
    sendBrowser: (method, params) => raw(method, params),
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
      ws.close();
    },
  };
  return page;
}
