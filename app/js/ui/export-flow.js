// @ts-check
/**
 * Two-step file export, used by Backup and data and by a project's
 * traveler: a Prepare button builds the files, then Share… (when the share
 * sheet takes them) or Download saves them. Two taps, because iOS opens the
 * share sheet only from a fresh tap, not at the end of a slow build.
 */
import { h, fill } from './dom.js';
import { button, toast, errorText } from './components.js';
import { canShareFiles, shareFiles, downloadFile } from '../data/backup.js';
import { fmtNum } from '../core/format.js';

/**
 * @param {number | null | undefined} n bytes
 * @returns {string} "820 KB", "12.3 MB", "1.2 GB" (decimal units)
 */
export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 1000) return `${n} bytes`;
  if (n < 1e6) return `${fmtNum(n / 1e3)} KB`;
  if (n < 1e9) return `${fmtNum(n / 1e6)} MB`;
  return `${fmtNum(n / 1e9)} GB`;
}

/**
 * Step two of an export: the prepared files with Share… (when the share
 * sheet takes them) and Download buttons. `onSaved` runs after a share
 * that went through, or a download.
 * @param {File[]} files
 * @param {{title: string, shared?: string, onSaved?: () => Promise<void>}} o
 * @returns {HTMLElement}
 */
export function preparedCard(files, o) {
  const several = files.length > 1;
  const saved = async (/** @type {string} */ message) => {
    try {
      await o.onSaved?.();
      toast(message);
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };
  const share = canShareFiles(files) ? button(several ? 'Share all…' : 'Share…', {
    kind: 'primary', icon: 'share', big: true,
    onClick: async () => {
      try {
        const r = await shareFiles(files, o.title);
        if (r === 'shared') await saved(o.shared || (several ? 'Files shared.' : 'Backup shared.'));
        else if (r === 'unsupported') toast('This browser cannot share these files. Use Download.');
      } catch (err) {
        toast(`Could not share: ${errorText(err)} Use Download instead.`, { kind: 'error' });
      }
    },
  }) : null;
  const downloads = files.map((f) => button(several ? `Download ${f.name}` : 'Download', {
    kind: share ? 'secondary' : 'primary', icon: 'download', big: true,
    onClick: async () => {
      try {
        downloadFile(f);
      } catch (err) {
        toast(`Could not download: ${errorText(err)}`, { kind: 'error' });
        return;
      }
      await saved(`Saving ${f.name}. Check your Downloads folder.`);
    },
  }));
  return h('div', { class: 'card stack' },
    files.map((f) => h('p', { class: 'small' }, h('strong', null, f.name), ` · ${formatBytes(f.size)}`)),
    share,
    downloads,
    share ? null : h('p', { class: 'field-note' }, 'This browser cannot send these files to the share sheet, so download them.'));
}

/**
 * A Prepare button, a status line and the prepared result.
 * @param {{label: string, kind?: 'primary' | 'secondary', icon: string, busy: () => string,
 *   make: () => Promise<File[]>, ready: (files: File[]) => string, title: string, shared?: string,
 *   onSaved?: () => Promise<void>}} o
 * @returns {{el: HTMLElement, reset: () => void}}
 */
export function exportFlow(o) {
  const status = h('p', { class: 'field-note', role: 'status' });
  const result = h('div');
  const prepare = button(o.label, {
    kind: o.kind || 'secondary', icon: o.icon, big: true,
    onClick: async () => {
      prepare.disabled = true;
      fill(result);
      status.textContent = o.busy();
      try {
        const files = await o.make();
        status.textContent = o.ready(files);
        fill(result, preparedCard(files, o));
        /** @type {HTMLElement | null} */ (result.querySelector('button'))?.focus();
      } catch (err) {
        status.textContent = '';
        toast(`Could not prepare the export: ${errorText(err)}`, { kind: 'error' });
      } finally {
        prepare.disabled = false;
      }
    },
  });
  const reset = () => {
    fill(result);
    status.textContent = '';
  };
  return { el: h('div', { class: 'stack' }, prepare, status, result), reset };
}
