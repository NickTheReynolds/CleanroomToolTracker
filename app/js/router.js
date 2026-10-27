// @ts-check
/**
 * Hash router: "#/run/<id>" -> views/run-detail.js. Relative hash routes
 * keep the app working under any sub-path (GitHub Pages "/<repo>/").
 * View modules load on demand, so Home starts fast.
 */

/**
 * @typedef {Object} ViewContext
 * @property {Record<string, string>} params route parameters
 * @property {URLSearchParams} query parameters after "?" in the hash
 * @property {HTMLElement} root the view's own container
 * @property {string} path
 * @property {() => boolean} isCurrent false once the person navigated away
 * @property {(title: string) => void} setTitle ignored after navigating away
 * @property {(nodes: Node[]) => void} setActions fills the sticky bottom bar
 */

/** @typedef {{render: (ctx: ViewContext) => Promise<(() => void | Promise<void>) | void>}} ViewModule */
/** @typedef {{pattern: string, load: () => Promise<ViewModule>, parent: string | null}} Route */

/** @type {Route[]} */
export const ROUTES = [
  { pattern: '/', load: () => import('./views/home.js'), parent: null },
  { pattern: '/log', load: () => import('./views/log-run.js'), parent: '/' },
  { pattern: '/log/:toolId', load: () => import('./views/log-run.js'), parent: '/log' },
  { pattern: '/log/:toolId/:templateId', load: () => import('./views/log-run.js'), parent: '/log' },
  { pattern: '/capture', load: () => import('./views/quick-capture.js'), parent: '/' },
  { pattern: '/open', load: () => import('./views/open-runs.js'), parent: '/' },
  { pattern: '/run/:id', load: () => import('./views/run-detail.js'), parent: '/open' },
  { pattern: '/run/:runId/measure', load: () => import('./views/measurement.js'), parent: '/open' },
  { pattern: '/measure/:id', load: () => import('./views/measurement.js'), parent: '/open' },
  { pattern: '/lookup', load: () => import('./views/lookup.js'), parent: '/' },
  { pattern: '/lookup/:toolId', load: () => import('./views/lookup.js'), parent: '/lookup' },
  { pattern: '/lookup/:toolId/:templateId', load: () => import('./views/lookup.js'), parent: '/lookup' },
  { pattern: '/results', load: () => import('./views/lookup-results.js'), parent: '/lookup' },
  { pattern: '/tool/:id', load: () => import('./views/tool-detail.js'), parent: '/settings/tools' },
  { pattern: '/event', load: () => import('./views/tool-event.js'), parent: '/' },
  { pattern: '/event/:id', load: () => import('./views/tool-event.js'), parent: '/' },
  { pattern: '/history', load: () => import('./views/history.js'), parent: null },
  { pattern: '/settings', load: () => import('./views/settings.js'), parent: null },
  { pattern: '/settings/tools', load: () => import('./views/settings-tools.js'), parent: '/settings' },
  { pattern: '/settings/tool/:id', load: () => import('./views/settings-tools.js'), parent: '/settings/tools' },
  { pattern: '/settings/materials', load: () => import('./views/settings-materials.js'), parent: '/settings' },
  { pattern: '/settings/data', load: () => import('./views/settings-data.js'), parent: '/settings' },
  { pattern: '/settings/sync', load: () => import('./views/settings-sync.js'), parent: '/settings' },
  { pattern: '/install', load: () => import('./views/install.js'), parent: '/settings' },
  { pattern: '/template/:id', load: () => import('./views/template-editor.js'), parent: '/settings/tools' },
  { pattern: '/settings/my-tools', load: () => import('./views/my-tools.js'), parent: '/settings' },
  { pattern: '/settings/wafer-types', load: () => import('./views/wafer-types.js'), parent: '/settings' },
  { pattern: '/settings/wafer-type/:id', load: () => import('./views/wafer-types.js'), parent: '/settings/wafer-types' },
  { pattern: '/projects', load: () => import('./views/projects.js'), parent: '/' },
  { pattern: '/folder/:id', load: () => import('./views/projects.js'), parent: '/projects' },
  { pattern: '/project/new', load: () => import('./views/project-edit.js'), parent: '/projects' },
  { pattern: '/project/:id', load: () => import('./views/project-detail.js'), parent: '/projects' },
  { pattern: '/project/:id/edit', load: () => import('./views/project-edit.js'), parent: '/projects' },
];

/**
 * Split a location hash into path and query.
 * @param {string} hash e.g. "#/event?tool=abc"
 * @returns {{path: string, query: URLSearchParams}}
 */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const q = raw.indexOf('?');
  let path = q >= 0 ? raw.slice(0, q) : raw;
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return { path, query: new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '') };
}

/**
 * Find the route for a path.
 * @param {string} path
 * @param {Route[]} [routes]
 * @returns {{route: Route, params: Record<string, string>} | null}
 */
export function matchRoute(path, routes = ROUTES) {
  const parts = path.split('/').filter(Boolean);
  for (const route of routes) {
    const pat = route.pattern.split('/').filter(Boolean);
    if (pat.length !== parts.length) continue;
    /** @type {Record<string, string>} */
    const params = {};
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      if (pat[i].startsWith(':')) {
        try {
          params[pat[i].slice(1)] = decodeURIComponent(parts[i]);
        } catch {
          ok = false;
          break;
        }
      } else if (pat[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

let replacing = false;
/** In-app history of paths, so Back knows whether an earlier page exists. */
const stack = /** @type {string[]} */ ([]);

/**
 * Note the screen the app now shows (main.js calls it on every route).
 * @param {string} path
 * @param {boolean} replaced the history entry was replaced, not added
 */
export function track(path, replaced) {
  if (replaced && stack.length) stack[stack.length - 1] = path;
  else if (stack.length >= 2 && stack[stack.length - 2] === path) stack.pop();
  else if (stack[stack.length - 1] !== path) stack.push(path);
}

/** @returns {boolean} whether an earlier in-app page exists, for the Back button */
export function canGoBack() {
  return stack.length > 1;
}

/**
 * Go to a route. `replace` swaps the current history entry (used after a
 * save so Back does not return to the finished form). When that target is
 * the page just before this one (Save or Cancel on a form opened from it),
 * the app goes back instead: a replaced entry would leave two copies of
 * that page in a row, and the first Back would seem to do nothing.
 * @param {string} path e.g. "/run/abc"
 * @param {{replace?: boolean}} [opts]
 */
export function navigate(path, opts = {}) {
  const hash = `#${path}`;
  if (window.location.hash === hash) return;
  if (opts.replace && stack.length >= 2 && stack[stack.length - 2] === parseHash(hash).path) {
    window.history.back();
    return;
  }
  replacing = !!opts.replace;
  if (opts.replace) window.location.replace(hash);
  else window.location.hash = hash;
}

/** Re-render the current route (after discarding a draft, for example). */
export function refresh() {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** @returns {boolean} whether the pending navigation replaced the entry (read once) */
export function consumeReplace() {
  const r = replacing;
  replacing = false;
  return r;
}
