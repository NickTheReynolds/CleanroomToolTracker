// @ts-check
/*
 * LNF Run Log service worker. Precaches the app shell in a versioned cache
 * and serves it cache-first, so every feature works offline after the first
 * load. A new version installs alongside and waits; the app shows "Update
 * available - Reload" and activates it only when the person taps Reload.
 * scripts/bump-version.mjs changes CACHE_NAME; test/sw-assets.test.mjs
 * checks that ASSETS lists every file in app/.
 */
const CACHE_NAME = 'lnf-runlog-v1.4.1-dev';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'version.js',
  'css/base.css',
  'css/components.css',
  'css/forms.css',
  'css/chart.css',
  'css/layout.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  // Tool photos (scripts/tool-photos.mjs keeps these lines).
  'img/tools/053141-49c4f7e1.jpg',
  'img/tools/056061-d6668106.jpg',
  'img/tools/10020-0c832a87.jpg',
  'img/tools/10030-a58053bf.jpg',
  'img/tools/10051-726d399c.jpg',
  'img/tools/10061-27da7d01.jpg',
  'img/tools/110071-7758f4ed.jpg',
  'img/tools/110081-7758f4ed.jpg',
  'img/tools/110091-7758f4ed.jpg',
  'img/tools/110101-7758f4ed.jpg',
  'img/tools/120031-e63fb8e8.jpg',
  'img/tools/120041-07497c6c.jpg',
  'img/tools/120051-4c10ecb1.jpg',
  'img/tools/130011-1a513bc8.jpg',
  'img/tools/133001-941462b4.jpg',
  'img/tools/140020-8098c852.jpg',
  'img/tools/140031-ab49fe4e.jpg',
  'img/tools/140041-08ab68da.jpg',
  'img/tools/14021-eeeb505f.jpg',
  'img/tools/14051-fcaa58f1.jpg',
  'img/tools/14061-4596df26.jpg',
  'img/tools/143001-151d9dc3.jpg',
  'img/tools/15000-d8d14ba7.jpg',
  'img/tools/150001-040b9043.jpg',
  'img/tools/15001-63584884.jpg',
  'img/tools/160031-1c4c94ea.jpg',
  'img/tools/161000-47641619.jpg',
  'img/tools/170030-d1f79b2e.jpg',
  'img/tools/171010-8781c415.jpg',
  'img/tools/180011-b2855e0e.jpg',
  'img/tools/180021-27db1b2a.jpg',
  'img/tools/190001-b35ed981.jpg',
  'img/tools/190080-f7043e45.jpg',
  'img/tools/190081-583a01e1.jpg',
  'img/tools/200031-91514f11.jpg',
  'img/tools/200041-81a59da4.jpg',
  'img/tools/200051-cd542c60.jpg',
  'img/tools/200071-1165c70d.jpg',
  'img/tools/200091-ced4e83d.jpg',
  'img/tools/20031-58d1fae7.jpg',
  'img/tools/20040-a538ad56.jpg',
  'img/tools/21040-dea6de18.jpg',
  'img/tools/21051-9749669d.jpg',
  'img/tools/220001-d1172f11.jpg',
  'img/tools/30000-03aa6377.jpg',
  'img/tools/30061-0b78bc81.jpg',
  'img/tools/30071-0b78bc81.jpg',
  'img/tools/30081-4c10ecb1.jpg',
  'img/tools/30091-4c10ecb1.jpg',
  'img/tools/30111-e63fb8e8.jpg',
  'img/tools/32011-5bedc14c.jpg',
  'img/tools/33031-0b78bc81.jpg',
  'img/tools/33041-e63fb8e8.jpg',
  'img/tools/33051-5bedc14c.jpg',
  'img/tools/40000-03aa6377.jpg',
  'img/tools/40051-0b78bc81.jpg',
  'img/tools/40061-15504482.jpg',
  'img/tools/41000-8f5250dd.jpg',
  'img/tools/43011-9f21de4c.jpg',
  'img/tools/50020-bd2afd8c.jpg',
  'img/tools/50041-84956683.jpg',
  'img/tools/50101-5c1361ac.jpg',
  'img/tools/50111-4cc5e1f1.jpg',
  'img/tools/51000-caa57874.jpg',
  'img/tools/52011-53c9cb6c.jpg',
  'img/tools/53081-52ebd60e.jpg',
  'img/tools/53091-d1796e92.jpg',
  'img/tools/53111-58d4af8d.jpg',
  'img/tools/53121-0d5979f9.jpg',
  'img/tools/53131-7b49d83e.jpg',
  'img/tools/54071-fa2271b6.jpg',
  'img/tools/54081-c1bd173f.jpg',
  'img/tools/55131-5feb3eac.jpg',
  'img/tools/56051-5970cf0f.jpg',
  'img/tools/58001-98f1a2fb.jpg',
  'img/tools/59001-3ebfef05.jpg',
  'img/tools/61062-aabbe8be.jpg',
  'img/tools/61071-305a927a.jpg',
  'img/tools/61081-3add2c78.jpg',
  'img/tools/62020-ca10e1d6.jpg',
  'img/tools/62030-c1ed30c7.jpg',
  'img/tools/62040-82c6b40a.jpg',
  'img/tools/62050-5aa1c8af.jpg',
  'img/tools/62061-49e7485b.jpg',
  'img/tools/63010-b2a45e98.jpg',
  'img/tools/70001-7a7e35ef.jpg',
  'img/tools/71001-d9fc7a53.jpg',
  'img/tools/71011-1b2d5793.jpg',
  'img/tools/71181-9836a62f.jpg',
  'img/tools/71191-931aa3c4.jpg',
  'img/tools/71231-b8858ac8.jpg',
  'img/tools/80010-ce389bfe.jpg',
  'img/tools/80030-4dc568a8.jpg',
  'img/tools/80051-49968473.jpg',
  'img/tools/81061-0dade8d5.jpg',
  'img/tools/82041-81586cbb.jpg',
  'img/tools/82051-eadfcc9f.jpg',
  'img/tools/82060-112d2d95.jpg',
  'img/tools/82061-8e79fb4f.jpg',
  'img/tools/82071-89f24c8f.jpg',
  'img/tools/82080-9d2ebb9c.jpg',
  'img/tools/82081-f0fbd2d5.jpg',
  'img/tools/84030-8d31c6a3.jpg',
  'img/tools/84041-fe9d9460.jpg',
  'img/tools/85051-c4740751.jpg',
  'img/tools/86001-0ffaa7cb.jpg',
  'img/tools/86011-3b72164d.jpg',
  'img/tools/86021-57b3e358.jpg',
  'img/tools/87001-093f3c7d.jpg',
  'img/tools/90011-bf42eff6.jpg',
  'img/tools/Acid-80-c74151aa.jpg',
  'img/tools/IBond-5000-Ball-Bonder-1a20d496.jpg',
  'img/tools/IBond-5000-Wedge-Bonder-99a20ee4.jpg',
  'img/tools/Laurell-c9f9cede.jpg',
  'img/tools/PSC122M-70822574.jpg',
  'img/tools/Sample-mounting-station-8a933fc4.jpg',
  'img/tools/Sentro-Tech-1707b0ee.jpg',
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
  'js/core/field-help.js',
  'js/core/app-help.js',
  'js/core/values.js',
  'js/core/run-steps.js',
  'js/core/projects.js',
  'js/core/project-report.js',
  'js/core/folders.js',
  'js/core/metrology.js',
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
  'js/data/projects.js',
  'js/data/folders.js',
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
  'js/ui/timer.js',
  'js/ui/scatter.js',
  'js/ui/project-picker.js',
  'js/ui/run-steps.js',
  'js/ui/export-flow.js',
  'js/ui/project-card.js',
  'js/ui/folder-picker.js',
  'js/ui/run-table.js',
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
  'js/views/my-tools.js',
  'js/views/projects.js',
  'js/views/project-detail.js',
  'js/views/project-edit.js',
];

/** @type {any} */
const sw = self;

sw.addEventListener('install', (/** @type {any} */ event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // A tool photo never changes under its name (a new photo gets a new
    // one), so an update copies it from the previous version's cache
    // instead of downloading the photos again.
    /** @type {string[]} */
    const fetchNow = [];
    for (const url of ASSETS) {
      const old = url.startsWith('img/tools/') ? await caches.match(url) : undefined;
      if (old) await cache.put(url, old);
      else fetchNow.push(url);
    }
    // cache: 'reload' bypasses the HTTP cache so a new version never stores stale files.
    await cache.addAll(fetchNow.map((url) => new Request(url, { cache: 'reload' })));
  })());
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
