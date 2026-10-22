// @ts-check
/**
 * Settings -> Sync: connect this device to a private GitHub repository,
 * sync now, and see the last result. Each device keeps one file in the
 * repository; Sync merges everyone's (newer edits win, nothing is wiped).
 */
import { h, append, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, section, toast, badge, confirmDialog, errorText, labelRow } from '../ui/components.js';
import { refresh } from '../router.js';
import { getSettings, saveSettings } from '../data/repo.js';
import { githubClient, parseRepo } from '../sync/github.js';
import { checkRepo, syncNow } from '../sync/sync.js';
import { describeResult } from '../sync/plan.js';
import { formatDateTime, formatAgo } from '../core/time.js';
import { HELP } from '../core/app-help.js';

const SETUP_STEPS = [
  'On github.com, create a new repository (for example lnf-runlog-data) and keep it Private. Leave it empty.',
  'Open your profile picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.',
  'Repository access: Only select repositories → pick that repository. Permissions → Repository permissions → Contents: Read and write. Choose an expiration (for example one year).',
  'Generate the token, copy it, and paste it above with the repository name.',
  'Labmates: share that token privately, or move the repository to a free GitHub organization so each person can make their own token for it.',
];

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {any} settings
 * @returns {HTMLElement}
 */
function setupForm(ctx, settings) {
  const repoId = uid('repo');
  const tokenId = uid('token');
  const nameId = uid('dev');
  const cfg = settings.sync || {};
  const repoIn = /** @type {HTMLInputElement} */ (h('input', {
    id: repoId, class: 'input mono', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'owner/repository', value: cfg.repo || '',
  }));
  const tokenIn = /** @type {HTMLInputElement} */ (h('input', {
    id: tokenId, class: 'input mono', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'github_pat_…', value: cfg.token || '',
  }));
  const nameIn = /** @type {HTMLInputElement} */ (h('input', {
    id: nameId, class: 'input', type: 'text', autocomplete: 'off', placeholder: 'e.g. Ana’s iPhone', value: settings.deviceName || '',
  }));
  const status = h('p', { class: 'field-note', role: 'status' });
  const save = button('Save and check', {
    kind: 'primary', icon: 'check', big: true,
    onClick: async () => {
      const repo = parseRepo(repoIn.value);
      const token = tokenIn.value.trim();
      if (!repo) { status.textContent = 'Enter the repository as owner/name (or paste its github.com address).'; return; }
      if (!token) { status.textContent = 'Paste the access token.'; return; }
      save.disabled = true;
      status.textContent = 'Checking with GitHub…';
      try {
        const info = await checkRepo(githubClient({ repo, token }));
        const same = cfg.repo === repo;
        await saveSettings({
          deviceName: nameIn.value.trim() || settings.deviceName,
          sync: { ...(same ? cfg : {}), repo, token, seen: same ? cfg.seen || {} : {} },
        });
        toast(info.canWrite === false ? `Connected to ${info.fullName}, but the token cannot write there.` : `Connected to ${info.fullName}.`);
        refresh();
      } catch (err) {
        status.textContent = errorText(err);
      } finally {
        save.disabled = false;
      }
    },
  });
  return h('div', { class: 'stack' },
    h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: repoId }, 'Private repository'), 'Private repository', HELP.syncRepo), repoIn),
    h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: tokenId }, 'Access token'), 'Access token', HELP.syncToken), tokenIn,
      h('div', null, button('Show token', {
        kind: 'ghost', onClick: (e) => {
          const show = tokenIn.type === 'password';
          tokenIn.type = show ? 'text' : 'password';
          /** @type {HTMLElement} */ (e.currentTarget).textContent = show ? 'Hide token' : 'Show token';
        },
      })),
      h('p', { class: 'field-note' }, 'Stored only on this device, never in backups. It should allow “Contents: Read and write” on this one repository and nothing else.')),
    h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: nameId }, 'Name of this device'), 'Name of this device', HELP.syncDevice), nameIn,
      h('p', { class: 'field-note' }, 'Shown in the repository’s history, so you can tell devices apart.')),
    save, status);
}

/**
 * The Sync now button (it lives in the bottom bar) reporting into `progress`.
 * @param {HTMLElement} progress
 * @returns {HTMLButtonElement}
 */
function syncButton(progress) {
  const run = button('Sync now', {
    kind: 'primary', icon: 'sync', big: true,
    onClick: async () => {
      run.disabled = true;
      try {
        const r = await syncNow((m) => { progress.textContent = m; });
        toast(`Synced: ${describeResult(r)}.`);
        refresh();
      } catch (err) {
        progress.textContent = '';
        toast(`Sync failed: ${errorText(err)}`, { kind: 'error' });
      } finally {
        run.disabled = false;
      }
    },
  });
  return run;
}

/**
 * @param {any} settings
 * @param {HTMLElement} progress
 * @returns {HTMLElement}
 */
function statusCard(settings, progress) {
  const cfg = settings.sync;
  const last = cfg.lastSyncAt
    ? `Last synced ${formatDateTime(cfg.lastSyncAt, Date.now())} (${formatAgo(cfg.lastSyncAt, Date.now())})`
    : 'Not synced yet.';
  const problems = cfg.lastResult && cfg.lastResult.problems && cfg.lastResult.problems.length
    ? h('div', { class: 'banner', role: 'alert' }, icon('alert'), h('div', { class: 'banner-body' },
      h('p', null, h('strong', null, 'Some device files could not be read:')),
      h('ul', { class: 'small' }, cfg.lastResult.problems.map((p) => h('li', null, p)))))
    : null;
  return h('div', { class: 'card stack' },
    h('div', { class: 'spread' }, h('strong', { class: 'mono' }, cfg.repo), badge('Private', 'ok', 'check')),
    h('p', null, last),
    cfg.lastResult ? h('p', { class: 'muted small' }, describeResult(cfg.lastResult)) : null,
    problems, progress);
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Sync');
  const settings = /** @type {any} */ (await getSettings());
  const connected = !!(settings.sync && settings.sync.repo && settings.sync.token);
  const progress = h('p', { class: 'field-note', role: 'status' });
  append(ctx.root, [
    h('p', null, 'Keep runs the same on your phones, computers and labmates’ devices through a private GitHub repository. Each device keeps one file there; Sync merges everyone’s: the newer edit wins, deletions carry over, and nothing is wiped.'),
    connected ? section('Status', statusCard(settings, progress)) : null,
    section(connected ? 'Connection' : 'Connect this device', connected
      ? h('details', { class: 'more' }, h('summary', null, 'Change repository or token'), setupForm(ctx, settings))
      : setupForm(ctx, settings)),
    h('details', { class: 'more card' }, h('summary', null, 'Set up the repository and token (once)'),
      h('ol', { class: 'steps' }, SETUP_STEPS.map((s) => h('li', null, s)))),
    h('p', { class: 'muted small' }, 'Photos are not synced: each stays on the device that took it. The repository holds your records unencrypted, so keep it private and share access only with people you trust. Every sync is a commit, so its history doubles as a backup.'),
    connected ? h('div', null, button('Stop syncing on this device', {
      kind: 'ghost', icon: 'close',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'Stop syncing on this device?',
          message: 'This removes the repository and token from this device. Your data here stays, and the repository is not changed.',
          confirmLabel: 'Stop syncing',
        });
        if (!ok) return;
        await saveSettings({ sync: null });
        toast('Sync is off on this device.');
        refresh();
      },
    })) : null,
  ]);
  if (connected) ctx.setActions([syncButton(progress)]);
}
