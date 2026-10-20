// @ts-check
/*
 * LNF Run Log service worker. Precaches the app shell in a versioned cache
 * and serves it cache-first, so every feature works offline after the first
 * load. A new version installs alongside and waits; the app shows "Update
 * available - Reload" and activates it only when the person taps Reload.
 * scripts/bump-version.mjs changes CACHE_NAME; test/sw-assets.test.mjs
 * checks that ASSETS lists every file in app/.
 */
const CACHE_NAME = 'lnf-runlog-v1.0.0-dev';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'version.js',
  'css/base.css',
  'css/components.css',
  'css/forms.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/main.js',
  'js/router.js',
  'js/config.js',
  'js/core/ids.js',
  'js/core/time.js',
  'js/core/vocab.js',
  'js/core/format.js',
  'js/core/types.js',
  'js/core/stats.js',
  'js/core/derive.js',
  'js/data/db.js',
  'js/data/schema.js',
  'js/data/records.js',
  'js/data/runs.js',
  'js/data/repo.js',
  'js/data/seed-tools.js',
  'js/data/seed-templates.js',
  'js/ui/dom.js',
  'js/ui/icons.js',
  'js/ui/components.js',
  'js/ui/fields.js',
  'js/ui/shell.js',
  'js/ui/theme.js',
  'js/ui/autosave.js',
  'js/ui/pwa.js',
  'js/ui/run-list.js',
  'js/ui/field-spec-editor.js',
  'js/views/home.js',
  'js/views/settings.js',
  'js/views/settings-tools.js',
  'js/views/template-editor.js',
];

/** @type {any} */
const sw = self;

sw.addEventListener('install', (/** @type {any} */ event) => {
  // cache: 'reload' bypasses the HTTP cache so a new version never stores stale files.
  event.waitUntil(caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))));
});

sw.addEventListener('activate', (/** @type {any} */ event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('lnf-runlog-') && k !== CACHE_NAME)
      .map((k) => caches.delete(k)));
    await sw.clients.claim();
  })());
});

sw.addEventListener('message', (/** @type {any} */ event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') sw.skipWaiting();
});

sw.addEventListener('fetch', (/** @type {any} */ event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (req.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
    // The app is one page with hash routes: answer page loads with the shell.
    event.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
