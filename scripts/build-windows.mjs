#!/usr/bin/env node
// @ts-check
/**
 * Build the Windows desktop app and its installer (docs/DESKTOP.md). It
 * stages app/ in a temp folder (stamping only the copies of sw.js and
 * version.js) with the icon, LICENSE and the WebView2 notices, fetches the pinned WebView2 SDK
 * from NuGet, compiles the launcher and the setup with the C# 5 compiler
 * built into Windows, and writes dist/LNF-Run-Log-Setup-<version>.exe.
 * Node built-ins only. The build runs on Windows; the helpers it exports
 * are pure and tested on any OS.
 *
 *   node scripts/build-windows.mjs           # build
 *   node scripts/build-windows.mjs --smoke   # build, then install into a temp folder and test it
 */
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_RE, VERSION_RE } from './bump-version.mjs';
import { appIco } from './ico.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WINDIR = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
/** The .NET Framework 4.x C# compiler that ships with Windows (C# 5 only). */
export const CSC = join(WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
/** bsdtar, part of Windows 10 1803 and later; it reads .nupkg (zip) files. */
export const TAR = join(WINDIR, 'System32', 'tar.exe');
/** C# sources in desktop/windows/ for each exe (plus the generated BuildInfo.cs). */
export const LAUNCHER_SOURCES = ['Launcher.cs', 'Placement.cs', 'Shell.cs'];
export const SETUP_SOURCES = ['Setup.cs', 'SetupFiles.cs', 'SetupForm.cs', 'Shell.cs'];

/** The desktop app's origin (MainForm.AppHost in desktop/windows/Launcher.cs). It keys all IndexedDB data: never change it. */
export const APP_ORIGIN = 'https://app.lnf-runlog.example';
export const EXE_NAME = 'LNF Run Log.exe';
export const ICON_NAME = 'LNF Run Log.ico';
export const UNINSTALLER_NAME = 'Uninstall LNF Run Log.exe';

/** WebView2 SDK: the newest stable release at least a month old when pinned (2026-10-20; published 2026-08-28). */
export const WEBVIEW2_VERSION = '1.0.4191.47';
/** SHA-256 of microsoft.web.webview2.1.0.4191.47.nupkg (its SHA-512 matched the NuGet catalog's packageHash). */
export const WEBVIEW2_SHA256 = 'f492bbf547d0da329553b6727435b677579b1e9f91cc9e4a1ad029366d5f23d0';
/**
 * The package members the build uses. Only these are extracted: the package
 * also holds C headers and XML docs far over the 1000-line limit, and
 * scripts/check-line-limits.mjs walks .cache/ too.
 */
export const WEBVIEW2_FILES = Object.freeze({
  core: 'lib/net462/Microsoft.Web.WebView2.Core.dll',
  winforms: 'lib/net462/Microsoft.Web.WebView2.WinForms.dll',
  loader: 'runtimes/win-x64/native/WebView2Loader.dll',
  license: 'LICENSE.txt',
});

export const BUILD_RE = /export const APP_BUILD = '[^']*';/;

/**
 * Every file under dir, as sorted relative paths with forward slashes.
 * @param {string} dir
 * @returns {string[]}
 */
export function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} sub */
  const walk = (sub) => {
    for (const e of readdirSync(join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      // A sync client's placeholder (a reparse point) can show as neither; ask the file itself.
      const st = e.isDirectory() || e.isFile() ? e : statSync(join(dir, ...rel.split('/')), { throwIfNoEntry: false });
      if (st?.isDirectory()) walk(rel);
      else if (st?.isFile()) out.push(rel);
    }
  };
  walk('');
  return out.sort();
}

/**
 * The files the service worker precaches (its ASSETS list without the scope
 * root './'), plus sw.js itself: exactly the files app/ should have.
 * @param {string} swSrc text of app/sw.js
 * @returns {string[]} sorted relative paths
 */
export function assetFiles(swSrc) {
  const m = /const ASSETS = \[([\s\S]*?)\];/.exec(swSrc);
  if (!m) throw new Error('ASSETS not found in sw.js');
  const listed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((a) => a !== './');
  return [...new Set([...listed, 'sw.js'])].sort();
}

/**
 * Refuse to build from an app/ listing that disagrees with the precache list.
 * npm test keeps the two equal, so a difference means the listing missed
 * files, as happens while a sync client turns them into placeholders.
 * @param {string[]} files listFiles(app/)
 * @param {string} swSrc text of app/sw.js
 */
export function checkAssets(files, swSrc) {
  const want = assetFiles(swSrc);
  const missing = want.filter((f) => !files.includes(f));
  const extra = files.filter((f) => !want.includes(f));
  if (missing.length || extra.length) {
    throw new Error(`app/ and the ASSETS list in app/sw.js disagree.${missing.length ? ` Not found in app/: ${missing.join(', ')}.` : ''}`
      + `${extra.length ? ` Not in ASSETS: ${extra.join(', ')}.` : ''} If a sync client (Synology Drive, OneDrive) is busy with`
      + ' the folder, wait a moment and build again; otherwise fix ASSETS (npm test checks it).');
  }
}

/**
 * Short content hash of a set of files: SHA-256 over each path and its bytes, in path order.
 * @param {string} dir
 * @param {string[]} files relative paths with forward slashes
 * @returns {string} the first 8 hex digits
 */
export function hashFiles(dir, files) {
  const h = createHash('sha256');
  for (const f of [...files].sort()) {
    h.update(`${f}\0`);
    h.update(readFileSync(join(dir, ...f.split('/'))));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 8);
}

/**
 * @param {string} versionSrc text of app/version.js
 * @returns {string} APP_VERSION, e.g. "1.0.0"
 */
export function readVersion(versionSrc) {
  const m = VERSION_RE.exec(versionSrc);
  if (!m) throw new Error('APP_VERSION not found in version.js');
  return m[1];
}

/**
 * The staged sw.js: a cache name unique to this build, so an update installed over an older one never serves stale files.
 * @param {string} src text of app/sw.js
 * @param {string} version
 * @param {string} hash8
 * @returns {string}
 */
export function stampServiceWorker(src, version, hash8) {
  if (!CACHE_RE.test(src)) throw new Error('CACHE_NAME not found in sw.js');
  return src.replace(CACHE_RE, `const CACHE_NAME = 'lnf-runlog-v${version}-d${hash8}';`);
}

/**
 * The staged version.js, with APP_BUILD 'desktop-<hash8>'.
 * @param {string} src text of app/version.js
 * @param {string} hash8
 * @returns {string}
 */
export function stampVersionJs(src, hash8) {
  if (!BUILD_RE.test(src)) throw new Error('APP_BUILD not found in version.js');
  return src.replace(BUILD_RE, `export const APP_BUILD = 'desktop-${hash8}';`);
}

/**
 * Copy the app folder verbatim into outDir (replacing it), then stamp the
 * COPIES of sw.js and version.js. The source folder is never modified.
 * @param {string} appDir
 * @param {string} outDir
 * @returns {{version: string, hash8: string, files: string[]}}
 */
export function stageApp(appDir, outDir) {
  const files = listFiles(appDir);
  for (const need of ['index.html', 'sw.js', 'version.js']) {
    if (!files.includes(need)) throw new Error(`${appDir} has no ${need}`);
  }
  const hash8 = hashFiles(appDir, files);
  const versionSrc = readFileSync(join(appDir, 'version.js'), 'utf8');
  const version = readVersion(versionSrc);
  const sw = stampServiceWorker(readFileSync(join(appDir, 'sw.js'), 'utf8'), version, hash8);
  const versionJs = stampVersionJs(versionSrc, hash8);
  rmSync(outDir, { recursive: true, force: true });
  for (const f of files) {
    const dest = join(outDir, ...f.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(appDir, ...f.split('/')), dest);
  }
  writeFileSync(join(outDir, 'sw.js'), sw);
  writeFileSync(join(outDir, 'version.js'), versionJs);
  return { version, hash8, files };
}

/**
 * One csc response-file line; quoted when it has spaces.
 * @param {string} option
 * @returns {string}
 */
export function rspLine(option) {
  if (!/^[\x20-\x7e]+$/.test(option) || option.includes('"')) {
    throw new Error(`Only printable ASCII without quotes fits a csc response file: ${option}`);
  }
  return /\s/.test(option) ? `"${option}"` : option;
}

/**
 * csc options that embed each payload file as the resource "payload/<rel>".
 * @param {string} payloadDir the payload folder, relative to the compiler's working folder
 * @param {string[]} files relative paths with forward slashes
 * @returns {string[]}
 */
export function resourceOptions(payloadDir, files) {
  return files.map((rel) => {
    if (rel.includes(',')) throw new Error(`A comma cannot appear in a payload file name: ${rel}`);
    return `/resource:${join(payloadDir, ...rel.split('/'))},payload/${rel}`;
  });
}

/**
 * Generated C#: version constants for both exes, and the target framework
 * (modern .NET 4.8 behaviour, e.g. PNG frames in icons).
 * @param {string} version
 * @param {string} hash8
 * @returns {string}
 */
export function buildInfoSource(version, hash8) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{8}$/.test(hash8)) throw new Error(`Bad version ${version} or hash ${hash8}`);
  return `// Generated by scripts/build-windows.mjs; do not edit.
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName = ".NET Framework 4.8")]

namespace LnfRunLog
{
    static class BuildInfo
    {
        public const string Version = "${version}";
        public const string FileVersion = "${version}.0";
        public const string Build = "desktop-${hash8}";
    }
}
`;
}

/**
 * Application manifest: never elevate (setup-like names would otherwise ask
 * for admin), Windows 10/11, and DPI awareness (per monitor for the app).
 * @param {boolean} perMonitor
 * @returns {string}
 */
export function manifestXml(perMonitor) {
  const dpi = perMonitor
    ? `<dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>`
    : '<dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>';
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      ${dpi}
    </windowsSettings>
  </application>
</assembly>
`;
}

/**
 * THIRD-PARTY-NOTICES.txt for the install folder (CRLF line ends).
 * @param {string} licenseText LICENSE.txt from the WebView2 package
 * @param {string} version
 * @returns {string}
 */
export function thirdPartyNotices(licenseText, version) {
  return `LNF Run Log for Windows includes these files from the Microsoft.Web.WebView2 ${version} NuGet package
(https://www.nuget.org/packages/Microsoft.Web.WebView2):
Microsoft.Web.WebView2.Core.dll, Microsoft.Web.WebView2.WinForms.dll and WebView2Loader.dll.
They are distributed under this license:

${licenseText.trim()}
`.replace(/\r?\n/g, '\r\n');
}

/** @param {Buffer} buf @returns {string} */
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Download the pinned WebView2 package once into cacheDir (verifying its
 * hash every build), then extract the members the build uses.
 * @param {string} cacheDir .cache/webview2/<version>
 * @returns {Promise<Record<keyof typeof WEBVIEW2_FILES, string>>} absolute paths of the extracted files
 */
async function ensureWebView2(cacheDir) {
  const name = `microsoft.web.webview2.${WEBVIEW2_VERSION}.nupkg`;
  const pkg = join(cacheDir, name);
  if (existsSync(pkg) && sha256(readFileSync(pkg)) !== WEBVIEW2_SHA256) {
    console.log(`The cached ${name} does not match its pinned hash; downloading it again.`);
    rmSync(pkg);
  }
  if (!existsSync(pkg)) {
    const url = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WEBVIEW2_VERSION}/${name}`;
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}): ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== WEBVIEW2_SHA256) {
      throw new Error(`SHA-256 MISMATCH for ${name}: expected ${WEBVIEW2_SHA256}, got ${got}. It is not the pinned package; nothing was built.`);
    }
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(`${pkg}.part`, buf);
    renameSync(`${pkg}.part`, pkg);
  }
  const out = join(cacheDir, 'pkg');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  run(TAR, ['-xf', pkg, '-C', out, ...Object.values(WEBVIEW2_FILES)]);
  const paths = /** @type {Record<keyof typeof WEBVIEW2_FILES, string>} */ (Object.fromEntries(
    Object.entries(WEBVIEW2_FILES).map(([k, rel]) => [k, join(out, ...rel.split('/'))])));
  for (const p of Object.values(paths)) if (!existsSync(p)) throw new Error(`Not in the WebView2 package: ${p}`);
  return paths;
}

/**
 * @param {string} exe
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opts]
 * @returns {string} stdout
 */
function run(exe, args, opts = {}) {
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${basename(exe)} failed (exit ${r.status}):\n${r.stdout}${r.stderr}`);
  return String(r.stdout);
}

/**
 * Write a response file into cwd and compile it with csc there.
 * @param {string} cwd
 * @param {string} rspName
 * @param {string[]} options paths relative to cwd
 */
function compile(cwd, rspName, options) {
  const lines = ['/nologo', '/optimize+', '/codepage:65001', '/utf8output', ...options].map(rspLine);
  writeFileSync(join(cwd, rspName), `${lines.join('\r\n')}\r\n`);
  const out = run(CSC, [`@${rspName}`], { cwd }).trim();
  if (out) console.log(out);
}

/**
 * Build dist/LNF-Run-Log-Setup-<version>.exe. Staging and compiling happen
 * in a new temp folder, not in the repo: a sync client (Synology Drive,
 * OneDrive) turns new files there into placeholders while the build runs,
 * and a listing taken meanwhile once left js/ui/ and icons/ out of the setup.
 * @returns {Promise<{setup: string, staging: string, payloadFiles: string[]}>} the setup exe, the
 *   staging folder (the caller deletes it) and the payload files as relative paths
 */
export async function buildWindows() {
  if (process.platform !== 'win32') throw new Error('The Windows build runs on Windows only (it uses csc.exe and tar.exe from Windows).');
  for (const tool of [CSC, TAR]) if (!existsSync(tool)) throw new Error(`Not found: ${tool}`);
  const out = mkdtempSync(join(tmpdir(), 'lnf-runlog-build-'));
  try {
    const r = (/** @type {string} */ p) => relative(out, p);
    const payload = join(out, 'payload');
    mkdirSync(payload);
    const { version, hash8, files } = stageApp(join(ROOT, 'app'), join(payload, 'app'));
    checkAssets(files, readFileSync(join(ROOT, 'app', 'sw.js'), 'utf8'));
    console.log(`Staged app/ (${files.length} files): version ${version}, build desktop-${hash8}`);
    const icon = join(payload, ICON_NAME);
    writeFileSync(icon, appIco());
    // The project's own license (AGPL-3.0-or-later), copied byte for byte.
    if (!existsSync(join(ROOT, 'LICENSE'))) throw new Error('LICENSE is missing from the repo root.');
    copyFileSync(join(ROOT, 'LICENSE'), join(payload, 'LICENSE.txt'));
    const wv = await ensureWebView2(join(ROOT, '.cache', 'webview2', WEBVIEW2_VERSION));
    const dlls = [wv.core, wv.winforms, wv.loader].map((p) => basename(p));
    for (const p of [wv.core, wv.winforms, wv.loader]) copyFileSync(p, join(payload, basename(p)));
    writeFileSync(join(payload, 'THIRD-PARTY-NOTICES.txt'), thirdPartyNotices(readFileSync(wv.license, 'utf8'), WEBVIEW2_VERSION));
    writeFileSync(join(out, 'BuildInfo.cs'), buildInfoSource(version, hash8));
    writeFileSync(join(out, 'launcher.manifest'), manifestXml(true));
    writeFileSync(join(out, 'setup.manifest'), manifestXml(false));
    // The C# sources go next to the response files, so csc sees only short relative paths.
    mkdirSync(join(out, 'src'));
    for (const f of new Set([...LAUNCHER_SOURCES, ...SETUP_SOURCES])) copyFileSync(join(ROOT, 'desktop', 'windows', f), join(out, 'src', f));
    const cs = (/** @type {string} */ f) => join('src', f);
    compile(out, 'launcher.rsp', [
      '/target:winexe', '/platform:x64', `/out:${r(join(payload, EXE_NAME))}`,
      `/win32icon:${r(icon)}`, '/win32manifest:launcher.manifest', `/resource:${r(icon)},app.ico`,
      `/reference:${r(join(payload, dlls[0]))}`, `/reference:${r(join(payload, dlls[1]))}`,
      '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
      ...LAUNCHER_SOURCES.map(cs), 'BuildInfo.cs',
    ]);
    // The payload by name, not by listing the folder, then checked against the folder.
    const payloadFiles = [...files.map((f) => `app/${f}`), EXE_NAME, ICON_NAME, 'LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', ...dlls].sort();
    const staged = listFiles(payload);
    if (staged.join('\n') !== payloadFiles.join('\n')) {
      throw new Error(`The staged payload does not match the build's list.\n  staged: ${staged.join(', ')}\n  listed: ${payloadFiles.join(', ')}`);
    }
    compile(out, 'setup.rsp', [
      '/target:winexe', '/platform:anycpu', '/out:setup.exe',
      `/win32icon:${r(icon)}`, '/win32manifest:setup.manifest',
      '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
      ...SETUP_SOURCES.map(cs), 'BuildInfo.cs',
      ...resourceOptions(r(payload), payloadFiles),
    ]);
    const setup = join(ROOT, 'dist', `LNF-Run-Log-Setup-${version}.exe`);
    mkdirSync(dirname(setup), { recursive: true });
    copyFileSync(join(out, 'setup.exe'), setup);
    console.log(`Wrote ${setup} (${(statSync(setup).size / 1048576).toFixed(2)} MB, ${payloadFiles.length} payload files)`);
    return { setup, staging: out, payloadFiles };
  } catch (err) {
    rmSync(out, { recursive: true, force: true });
    throw err;
  }
}

const sleep = (/** @type {number} */ ms) => new Promise((res) => setTimeout(res, ms));

/** @returns {Promise<number>} a TCP port that was free a moment ago */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address();
      srv.close(() => resolve(typeof a === 'object' && a ? a.port : 0));
    });
  });
}

/**
 * Start the installed app with a DevTools port and attach to its page.
 * @param {string} exe
 * @param {string} data LNF_RUNLOG_DATA
 */
async function startApp(exe, data) {
  const port = await freePort();
  const { connect, BLOCK_HOSTS_SWITCH } = await import('./cdp.mjs');
  const child = spawn(exe, [], {
    stdio: 'ignore',
    env: {
      ...process.env, LNF_RUNLOG_DATA: data,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} ${BLOCK_HOSTS_SWITCH}`,
    },
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (const end = Date.now() + 30000; ;) {
      if (child.exitCode !== null) throw new Error(`the app exited early (${child.exitCode})`);
      try {
        const list = await (await fetch(`${base}/json/list`)).json();
        if (list.some((/** @type {any} */ t) => t.type === 'page' && String(t.url).startsWith(APP_ORIGIN))) break;
      } catch { /* not listening yet */ }
      if (Date.now() > end) throw new Error('the app did not open its page within 30 s');
      await sleep(250);
    }
    const page = await connect((await (await fetch(`${base}/json/version`)).json()).webSocketDebuggerUrl);
    return { child, page, base };
  } catch (err) {
    spawnSync('taskkill.exe', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true }); // only the app this test started
    throw err;
  }
}

/**
 * Close the app like the person would (WM_CLOSE), then wait for WebView2 to let go of the data folder.
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} base DevTools address
 */
async function stopApp(child, base) {
  spawnSync('taskkill.exe', ['/PID', String(child.pid)], { windowsHide: true });
  for (let i = 0; child.exitCode === null; i++) {
    if (i === 60) spawnSync('taskkill.exe', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true });
    if (i > 80) throw new Error('the app did not exit');
    await sleep(250);
  }
  for (let i = 0; i < 80; i++) {
    try { await fetch(`${base}/json/version`); } catch { return; }
    await sleep(250);
  }
}

/**
 * End-to-end check of a built installer inside one new temp folder: silent
 * install (shortcuts in the temp folder, no registry), shortcut targets and
 * AppUserModelID, the page and window.LNF_DESKTOP over DevTools, IndexedDB
 * across a restart, then silent uninstall that keeps the data. The temp
 * folder is deleted on success and kept for inspection on failure.
 * @param {string} setupExe
 * @param {string} payload the staged payload folder the setup was built from
 * @param {string[]} payloadFiles its files, as relative paths
 * @returns {Promise<string>} a screenshot of the home screen (build/windows/smoke-home.png)
 */
export async function smokeTest(setupExe, payload, payloadFiles) {
  // Chromium's IndexedDB fails ("Internal error opening backing store")
  // once its files pass Windows' 260-character path limit, ~100 characters
  // below the data folder.
  if (join(tmpdir(), 'lnf-desktop-smoke-XXXXXX', 'data').length > 110) {
    throw new Error(`The temp folder path is too long for WebView2's IndexedDB: ${tmpdir()}. Set TEMP to a shorter folder.`);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'lnf-desktop-smoke-'));
  try {
    const shot = await smokeSteps(setupExe, payload, payloadFiles, tmp);
    rmSync(tmp, { recursive: true, force: true });
    return shot;
  } catch (err) {
    throw new Error(`${err instanceof Error ? err.message : err}\nThe test files are kept in ${tmp}`);
  }
}

/**
 * @param {string} setupExe
 * @param {string} payload
 * @param {string[]} payloadFiles
 * @param {string} tmp a new, empty folder
 * @returns {Promise<string>} the screenshot
 */
async function smokeSteps(setupExe, payload, payloadFiles, tmp) {
  const dir = join(tmp, 'install');
  const data = join(tmp, 'data');
  const links = [join(tmp, 'shortcuts', 'Start Menu', 'LNF Run Log.lnk'), join(tmp, 'shortcuts', 'Desktop', 'LNF Run Log.lnk')];
  const flags = ['/S', `/D=${dir}`, `/SHORTCUTS=${join(tmp, 'shortcuts')}`, '/NOREG'];
  const ok = (/** @type {boolean} */ cond, /** @type {string} */ what) => {
    if (!cond) throw new Error(`FAIL ${what}`);
    console.log(`  ok   ${what}`);
  };
  console.log(`Smoke test in ${tmp}`);
  let res = spawnSync(setupExe, [...flags, '/NOLAUNCH'], { encoding: 'utf8', windowsHide: true });
  ok(res.status === 0, `silent install exits 0 (got ${res.status} ${res.stderr || ''})`);
  const same = payloadFiles.every((f) => existsSync(join(dir, f)) && sha256(readFileSync(join(dir, f))) === sha256(readFileSync(join(payload, f))));
  ok(same && existsSync(join(dir, UNINSTALLER_NAME)), `every payload file (${payloadFiles.length}) is installed byte for byte, plus the uninstaller`);
  const appFiles = payloadFiles.filter((f) => f.startsWith('app/')).map((f) => f.slice(4));
  ok(listFiles(join(dir, 'app')).join('\n') === appFiles.join('\n'), `the installed app folder has exactly the ${appFiles.length} app files`);
  ok(readFileSync(join(dir, 'LICENSE.txt')).equals(readFileSync(join(ROOT, 'LICENSE'))), 'LICENSE.txt is the repo LICENSE, unchanged');
  const q = (/** @type {string} */ s) => s.replace(/'/g, "''");
  const ps = links.map((l) => `$i = $sh.NameSpace('${q(dirname(l))}').ParseName('${q(basename(l))}'); `
    + "$i.ExtendedProperty('System.Link.TargetParsingPath') + '|' + $i.ExtendedProperty('System.AppUserModel.ID')").join('; ');
  const lnk = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$sh = New-Object -ComObject Shell.Application; ${ps}`]);
  const want = `${join(dir, EXE_NAME)}|LNFRunLog.Desktop`;
  ok(lnk.trim().split(/\r?\n/).every((l) => l.trim().toLowerCase() === want.toLowerCase()) && lnk.trim().split(/\r?\n/).length === 2,
    `both shortcuts target the app with AppUserModelID LNFRunLog.Desktop (${lnk.trim().split(/\r?\n/).join('; ')})`);
  const marker = `smoke-${Date.now()}`;
  const shot = join(ROOT, 'build', 'windows', 'smoke-home.png');
  mkdirSync(dirname(shot), { recursive: true });
  let app = await startApp(join(dir, EXE_NAME), data);
  try {
    await app.page.waitFor(`document.querySelector('.home-grid')`, 30000);
    ok(await app.page.evaluate('location.origin + location.pathname') === `${APP_ORIGIN}/index.html`, `the page is ${APP_ORIGIN}/index.html with .home-grid`);
    const flag = await app.page.evaluate('JSON.stringify(window.LNF_DESKTOP)');
    ok(/^\{"platform":"windows","version":"\d+\.\d+\.\d+"\}$/.test(flag), `window.LNF_DESKTOP is ${flag}`);
    writeFileSync(shot, await app.page.screenshot());
    const saved = await app.page.evaluate(`import('./js/data/repo.js').then((r) => r.saveSettings({ userName: '${marker}' })).then((s) => s.userName)`);
    ok(saved === marker, `saveSettings({userName: '${marker}'}) in IndexedDB`);
    await app.page.close();
  } finally {
    await stopApp(app.child, app.base);
  }
  ok(existsSync(join(data, 'window.txt')), 'closing the window wrote window.txt');
  app = await startApp(join(dir, EXE_NAME), data);
  try {
    await app.page.waitFor(`document.querySelector('.home-grid')`, 30000);
    const back = await app.page.evaluate(`import('./js/data/repo.js').then((r) => r.getSettings()).then((s) => s.userName)`);
    ok(back === marker, `after a restart IndexedDB still has userName '${back}'`);
    await app.page.close();
  } finally {
    await stopApp(app.child, app.base);
  }
  res = spawnSync(join(dir, UNINSTALLER_NAME), flags, { encoding: 'utf8', windowsHide: true });
  ok(res.status === 0, `silent uninstall exits 0 (got ${res.status} ${res.stderr || ''})`);
  for (let i = 0; i < 40 && existsSync(dir); i++) await sleep(250);
  ok(!existsSync(dir), 'the install folder is gone (the uninstaller deleted itself)');
  ok(!links.some(existsSync), 'both shortcuts are gone');
  ok(existsSync(join(data, 'WebView2')), 'the run data folder is kept');
  return shot;
}

async function main() {
  const { setup, staging, payloadFiles } = await buildWindows();
  try {
    if (process.argv.includes('--smoke')) {
      const shot = await smokeTest(setup, join(staging, 'payload'), payloadFiles);
      console.log(`Smoke test passed. Screenshot: ${shot}`);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const isMain = () => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (isMain()) {
  if (process.argv.includes('--smoke') && typeof WebSocket === 'undefined' && !process.execArgv.includes('--experimental-websocket')) {
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
