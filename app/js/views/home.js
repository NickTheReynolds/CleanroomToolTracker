// @ts-check
/**
 * Home: four big buttons, the latest runs, a backup reminder and install
 * help.
 */
import { h, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, linkButton, section, emptyState } from '../ui/components.js';
import { runList, lookups } from '../ui/run-list.js';
import { canInstall, promptInstall, onInstallChange, isIos, isStandalone } from '../ui/pwa.js';
import {
  openRuns, recentRuns, listTools, listTemplates, getSettings, saveSettings,
} from '../data/repo.js';
import { DEFAULTS, UI } from '../config.js';
import { ageDays, formatDay } from '../core/time.js';

/**
 * @param {string} label
 * @param {string} href
 * @param {string} iconName
 * @param {{primary?: boolean, count?: number}} [o]
 * @returns {HTMLElement}
 */
function homeButton(label, href, iconName, o = {}) {
  const count = o.count ? h('span', { class: 'count' }, String(o.count),
    h('span', { class: 'visually-hidden' }, o.count === 1 ? ' run' : ' runs')) : null;
  return h('a', { class: ['home-btn', o.primary && 'home-btn-primary'], href }, icon(iconName), h('span', null, label), count);
}

/**
 * Backup reminder: shown when runs exist and there has been no export for
 * BACKUP_REMINDER_DAYS, or ever.
 * @param {string | null} lastExportAt
 * @returns {HTMLElement | null}
 */
function backupBanner(lastExportAt) {
  const days = lastExportAt ? ageDays(lastExportAt, Date.now()) : Infinity;
  if (days < DEFAULTS.BACKUP_REMINDER_DAYS) return null;
  const text = lastExportAt
    ? `Last backup ${formatDay(lastExportAt, Date.now())} (${Math.floor(days)} days ago).`
    : 'You have not exported a backup yet.';
  return h('div', { class: 'banner', role: 'status' }, icon('alert'),
    h('div', { class: 'banner-body' },
      h('p', null, h('strong', null, 'Back up your data. '), text, ' Browser storage can be cleared.'),
      h('div', null, linkButton('Export backup', '#/settings/data', { icon: 'download' }))));
}

/** @param {() => void} dismiss */
function iosHint(dismiss) {
  return h('div', { class: 'banner banner-info', role: 'note' }, icon('info'),
    h('div', { class: 'banner-body' },
      h('p', null, h('strong', null, 'Install on iPhone: '),
        'in Safari tap the Page Menu or Share button, then Share → Add to Home Screen, and keep “Open as Web App” on.'),
      h('p', { class: 'small' }, 'The Home Screen app keeps its own data, separate from Safari, so install it before you log runs.'),
      h('div', null, button('Got it', { onClick: dismiss }))));
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('LNF Run Log');
  const [open, recent, tools, templates, settings] = await Promise.all([
    openRuns(), recentRuns(UI.RECENT_RUNS_HOME), listTools({ includeArchived: true }), listTemplates(), getSettings(),
  ]);
  const L = lookups(tools, templates);

  const installSlot = h('div');
  const showInstall = () => {
    installSlot.replaceChildren();
    if (!canInstall()) return;
    installSlot.append(h('div', { class: 'banner banner-info' }, icon('download'),
      h('div', { class: 'banner-body' },
        h('p', null, 'Install LNF Run Log for full-screen, offline use.'),
        h('div', null, button('Install app', { kind: 'primary', icon: 'download', onClick: () => promptInstall() })))));
  };
  showInstall();
  const stopInstall = onInstallChange(showInstall);

  const hintSlot = h('div');
  if (isIos() && !isStandalone() && !settings.iosHintDismissed) {
    hintSlot.append(iosHint(async () => {
      hintSlot.replaceChildren();
      await saveSettings({ iosHintDismissed: true });
    }));
  }

  append(ctx.root, [
    recent.length ? backupBanner(settings.lastExportAt) : null,
    installSlot,
    hintSlot,
    h('nav', { class: 'home-grid', 'aria-label': 'Main tasks' },
      homeButton('Log run', '#/log', 'plus', { primary: true }),
      homeButton('Look up', '#/lookup', 'search'),
      homeButton('Open runs', '#/open', 'list', { count: open.length }),
      homeButton('Tool event', '#/event', 'wrench')),
    h('div', { class: 'home-secondary' },
      linkButton('Quick capture', '#/capture', { icon: 'bolt' }),
      linkButton('History', '#/history', { icon: 'history' })),
    section('Recent runs', recent.length
      ? runList(recent, L)
      : emptyState('No runs yet. Tap Log run to record your first one.')),
  ]);
  return stopInstall;
}
