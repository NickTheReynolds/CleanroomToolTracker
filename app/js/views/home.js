// @ts-check
/**
 * Home: a greeting with this week's count, four big buttons, the latest
 * runs, a backup reminder and install help.
 */
import { h, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, linkButton, section, emptyState, toast, errorText } from '../ui/components.js';
import { refresh } from '../router.js';
import { runList, lookups } from '../ui/run-list.js';
import { canInstall, promptInstall, onInstallChange, isIos, isStandalone } from '../ui/pwa.js';
import {
  openRuns, recentRuns, listRuns, listTools, listTemplates, getSettings, saveSettings,
} from '../data/repo.js';
import { DEFAULTS, UI } from '../config.js';
import { ageDays, formatDay, formatAgo, toMs } from '../core/time.js';

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
 * "Good morning, Ana" and "Tuesday, Oct 21 · 3 runs this week · 2 open".
 * @param {string} userName
 * @param {number} week runs started in the last 7 days
 * @param {number} open open and draft runs
 * @returns {HTMLElement}
 */
function hello(userName, week, open) {
  const now = new Date();
  const hour = now.getHours();
  const part = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = String(userName || '').trim().split(/\s+/)[0];
  const day = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const parts = [day, `${week} run${week === 1 ? '' : 's'} this week`, open ? `${open} open` : null];
  return h('div', { class: 'home-hello' }, h('h2', null, first ? `${part}, ${first}` : part), h('p', null, parts.filter(Boolean).join(' · ')));
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

/**
 * Sync status with a Sync now button, shown once sync is set up.
 * @param {import('../sync/sync.js').SyncConfig} sync
 * @returns {HTMLElement}
 */
function syncRow(sync) {
  const sub = h('span', { class: 'row-sub' }, sync.lastSyncAt ? `Last synced ${formatAgo(sync.lastSyncAt, Date.now())}` : 'Not synced yet');
  const btn = button('Sync now', {
    icon: 'sync',
    onClick: async () => {
      btn.disabled = true;
      sub.textContent = 'Syncing…';
      try {
        const [{ syncNow }, { describeResult }] = await Promise.all([import('../sync/sync.js'), import('../sync/plan.js')]);
        const r = await syncNow((m) => { sub.textContent = m; });
        toast(`Synced: ${describeResult(r)}.`);
        refresh();
      } catch (err) {
        sub.textContent = 'Sync failed';
        toast(`Sync failed: ${errorText(err)}`, { kind: 'error' });
      } finally {
        btn.disabled = false;
      }
    },
  });
  return h('div', { class: 'card spread' },
    h('a', { class: 'row-main sync-link', href: '#/settings/sync' }, h('span', { class: 'row-title' }, 'Sync'), sub), btn);
}

/** @param {() => void} dismiss */
function iosHint(dismiss) {
  return h('div', { class: 'banner banner-info', role: 'note' }, icon('info'),
    h('div', { class: 'banner-body' },
      h('p', null, h('strong', null, 'Install on iPhone: '),
        'in Safari tap the Page Menu or Share button, then Share → Add to Home Screen, and keep “Open as Web App” on.'),
      h('p', { class: 'small' }, 'The Home Screen app keeps its own data, separate from Safari, so install it before you log runs.'),
      h('div', { class: 'row-wrap' }, linkButton('Step by step', '#/install', { icon: 'info' }), button('Got it', { onClick: dismiss }))));
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('LNF Run Log');
  const [open, recent, runs, tools, templates, settings] = await Promise.all([
    openRuns(), recentRuns(UI.RECENT_RUNS_HOME), listRuns(), listTools({ includeArchived: true }), listTemplates(), getSettings(),
  ]);
  const weekAgo = Date.now() - 7 * 86400000;
  const week = runs.filter((r) => toMs(r.startedAt) >= weekAgo).length;
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
    hello(settings.userName, week, open.length),
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
    settings.sync && settings.sync.repo ? syncRow(settings.sync) : null,
    section('Recent runs', recent.length
      ? runList(recent, L)
      : emptyState('No runs yet. Tap Log run to record your first one.')),
  ]);
  return stopInstall;
}
