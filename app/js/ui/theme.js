// @ts-check
/**
 * Light / dark / system theme. Settings in IndexedDB hold the choice; a
 * localStorage mirror lets index.html apply it before first paint.
 */

const MIRROR_KEY = 'lnf-runlog-theme';
const HEADER = { light: '#0b5d7a', dark: '#0c2c38' };

/**
 * @param {string} theme "system", "light" or "dark"
 */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  try {
    if (theme === 'light' || theme === 'dark') localStorage.setItem(MIRROR_KEY, theme);
    else localStorage.removeItem(MIRROR_KEY);
  } catch { /* storage unavailable: the system theme applies until boot */ }
  // Keep the browser chrome colour in step with a forced theme.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') || '';
    const systemDark = media.includes('dark');
    const forced = theme === 'light' || theme === 'dark' ? theme : (systemDark ? 'dark' : 'light');
    meta.setAttribute('content', HEADER[/** @type {'light' | 'dark'} */ (forced)]);
  }
}
