// @ts-check
/*
 * LNF Run Log service worker. Precaches the app shell in a versioned cache
 * and serves it cache-first, so every feature works offline after the first
 * load. A new version installs alongside and waits; the app shows "Update
 * available - Reload" and activates it only when the person taps Reload.
 * scripts/bump-version.mjs changes CACHE_NAME; test/sw-assets.test.mjs
 * checks that ASSETS lists every file in app/.
 */
const CACHE_NAME = 'lnf-runlog-v1.2.0-dev';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'version.js',
  'css/base.css',
  'css/components.css',
  'css/forms.css',
  'css/chart.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  // Tool photos (scripts/tool-photos.mjs keeps these lines).
  'img/tools/10030.jpg',
  'img/tools/10061.jpg',
  'img/tools/110101.jpg',
  'img/tools/14021.jpg',
  'img/tools/170030.jpg',
  'img/tools/21040.jpg',
  'img/tools/21051.jpg',
  'img/tools/51000.jpg',
  'img/tools/53111.jpg',
  'img/tools/53131.jpg',
  'img/tools/54081.jpg',
  'img/tools/85051.jpg',
  // End of tool photos.
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
  'js/core/run-draft.js',
  'js/core/similarity.js',
  'js/core/summary.js',
  'js/core/summary-text.js',
  'js/core/search.js',
  'js/core/qr.js',
  'js/core/recipes.js',
  'js/core/csv.js',
  'js/core/xlsx.js',
  'js/core/pdf.js',
  'js/core/export-all.js',
  'js/data/db.js',
  'js/data/schema.js',
  'js/data/records.js',
  'js/data/runs.js',
  'js/data/repo.js',
  'js/data/seed-tools.js',
  'js/data/seed-templates.js',
  'js/data/photos.js',
  'js/data/export-import.js',
  'js/data/backup.js',
  'js/data/seed-types.js',
  'js/data/seed-upgrade.js',
  'js/data/seed-lnf.js',
  'js/data/recipes.js',
  'js/data/lnf-recipes-etch.js',
  'js/data/lnf-recipes-dep.js',
  'js/data/lnf-recipes-other.js',
  'js/data/lnf-wiki.js',
  'js/data/tool-photos.js',
  'js/sync/codec.js',
  'js/sync/github.js',
  'js/sync/plan.js',
  'js/sync/sync.js',
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
  'js/ui/pickers.js',
  'js/ui/photos.js',
  'js/ui/run-form.js',
  'js/ui/run-outputs.js',
  'js/ui/lookup-card.js',
  'js/ui/chart.js',
  'js/ui/qr.js',
  'js/ui/recipes.js',
  'js/ui/tool-card.js',
  'js/views/home.js',
  'js/views/settings.js',
  'js/views/settings-tools.js',
  'js/views/template-editor.js',
  'js/views/log-run.js',
  'js/views/quick-capture.js',
  'js/views/open-runs.js',
  'js/views/run-detail.js',
  'js/views/measurement.js',
  'js/views/tool-event.js',
  'js/views/lookup.js',
  'js/views/lookup-results.js',
  'js/views/settings-data.js',
  'js/views/install.js',
  'js/views/history.js',
  'js/views/tool-detail.js',
  'js/views/settings-sync.js',
  'js/views/settings-materials.js',
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
