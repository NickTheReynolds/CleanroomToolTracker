// @ts-check
/**
 * Settings -> Data: export a JSON backup (photos optional), export
 * everything as one CSV, Excel or PDF file, export CSV for Excel or Sheets, import a backup (a merge that never deletes), storage
 * status and Erase all data. Each export is prepared first and then shared
 * or downloaded with a second tap, because iOS opens the share sheet only
 * from a fresh tap, not at the end of a slow build.
 */
import { h, append, fill } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, linkButton, section, toggle, toast, confirmDialog, sheet, badge, errorText, segmented } from '../ui/components.js';
import { exportFlow, formatBytes } from '../ui/export-flow.js';
import { storageStatus, requestPersist } from '../ui/pwa.js';
import { refresh, navigate } from '../router.js';
import { SHARED_PROJECTS } from '../data/shared-projects.js';
import {
  estimatePhotoBytes, makeBackupFile, makeCsvFiles, makeAllExport, markExported, importBackupFile, eraseAllData,
} from '../data/backup.js';
import { getSettings, photoUsage, getProject } from '../data/repo.js';
import { UI } from '../config.js';
import { HELP } from '../core/app-help.js';
import { ageDays, formatDateTime } from '../core/time.js';

/** @typedef {import('../data/backup.js').ImportResult} ImportResult */

const STORE_LABELS = Object.freeze([
  ['tools', 'Tools'], ['templates', 'Templates'], ['runs', 'Runs'], ['measurements', 'Measurements'],
  ['events', 'Tool events'], ['photos', 'Photos and step files'], ['projects', 'Projects'], ['folders', 'Project folders'],
  ['wafers', 'Saved wafers and masks'],
]);

/**
 * @param {number} n
 * @param {string} word
 * @returns {string} "1 photo", "3 photos"
 */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** @param {number} n stored photos, with plan steps' pictures and files (1.6) @returns {string} "1 photo or file", "3 photos and files" */
const storedFiles = (n) => (n === 1 ? '1 photo or file' : `${n} photos and files`);

/**
 * @param {string | null} at settings.lastExportAt
 * @returns {string}
 */
function lastExportText(at) {
  if (!at) return 'No backup exported from this device yet.';
  const now = Date.now();
  const days = Math.floor(ageDays(at, now));
  return `Last backup from this device: ${formatDateTime(at, now)}${days >= 1 ? ` (${plural(days, 'day')} ago)` : ''}.`;
}

/**
 * @param {import('../data/records.js').Settings} settings
 * @param {{count: number, bytes: number}} photos
 * @param {number} photoEstimate bytes the photos add to a backup
 * @returns {HTMLElement}
 */
function backupSection(settings, photos, photoEstimate) {
  let includePhotos = false;
  const last = h('p', { class: 'muted' }, lastExportText(settings.lastExportAt));
  const warning = h('p', { class: 'field-note warn', hidden: true },
    `Photos and files make the backup about ${formatBytes(photoEstimate)} larger. Big files are slow to prepare and share, and are often too large for email: save them to Files or Drive instead.`);
  const flow = exportFlow({
    label: 'Prepare backup',
    kind: 'primary',
    icon: 'download',
    busy: () => (includePhotos && photos.count ? 'Preparing the backup with photos and files…' : 'Preparing the backup…'),
    make: async () => [await makeBackupFile({ includePhotos, onWarning: (m) => toast(m, { kind: 'error' }) })],
    ready: () => 'Backup ready. Share or download it below.',
    title: 'LNF Run Log backup',
    onSaved: async () => { last.textContent = lastExportText(await markExported()); },
  });
  return section('Backup',
    h('p', null, 'One file with all your tools, templates, runs, measurements, tool events, projects and their folders, saved wafers and masks, materials and lookup tuning. Keep a copy off this device, for example in Files, Drive or email.'),
    last,
    toggle({
      label: 'Include photos and files', help: HELP.includePhotos,
      hint: photos.count
        ? `${storedFiles(photos.count)}, about ${formatBytes(photoEstimate)} in the backup`
        : 'No photos or files stored on this device.',
      checked: false,
      onChange: (v) => {
        includePhotos = v;
        warning.hidden = !(v && photos.count);
        flow.reset();
      },
    }),
    warning,
    flow.el);
}

/** What each format of the export of everything holds. */
const EVERYTHING_NOTES = Object.freeze({
  xlsx: 'An Excel workbook: all runs on one sheet, one sheet per tool with named columns, then the measurements and tool events.',
  csv: 'One table with a row per run: a p. column for each parameter, an r. column for each result, the mean of each kind of measurement, and every measurement in words. Tool events are in events.csv below.',
  pdf: "A report to read or print: each tool's runs with their inputs, results, measurements and notes, then its tool events.",
});

/** @returns {HTMLElement} */
function everythingSection() {
  /** @type {'xlsx' | 'csv' | 'pdf'} */
  let format = 'xlsx';
  const note = h('p', { class: 'muted small' }, EVERYTHING_NOTES[format]);
  const flow = exportFlow({
    label: 'Prepare the export',
    icon: 'download',
    busy: () => 'Preparing the export…',
    make: () => makeAllExport(format),
    ready: () => 'Ready. Share or download it below.',
    title: 'LNF Run Log export',
    shared: 'Export shared.',
  });
  return section('Export everything',
    h('p', null, 'Every run with its parameters, results and measurements in one file; the Excel and PDF files also list the tool events. Deleted records are left out.'),
    segmented({
      label: 'Format', value: format, help: HELP.exportFormat,
      options: [{ value: 'xlsx', label: 'Excel' }, { value: 'csv', label: 'CSV' }, { value: 'pdf', label: 'PDF' }],
      onChange: (v) => {
        if (!v) return;
        format = /** @type {'xlsx' | 'csv' | 'pdf'} */ (v);
        note.textContent = EVERYTHING_NOTES[format];
        flow.reset();
      },
    }),
    note,
    flow.el);
}

/** @returns {HTMLElement} */
function csvSection() {
  const flow = exportFlow({
    label: 'Prepare CSV files',
    icon: 'chart',
    busy: () => 'Preparing CSV files…',
    make: makeCsvFiles,
    ready: (files) => `${plural(files.length, 'file')} ready. Share or download them below.`,
    title: 'LNF Run Log CSV export',
  });
  return section('Export for Excel or Sheets',
    h('p', null, 'Three files: runs.csv has one row per run, with a p. column for each parameter and an r. column for each result; measurements.csv and events.csv hold the rest. Durations are in seconds, and deleted records are left out.'),
    h('p', { class: 'muted small' }, 'CSV files are for analysis and cannot be imported back. To move data between devices, use a backup.'),
    flow.el);
}

/**
 * The summary after an import: per-store counts, problems, and the rules.
 * @param {string} name file name
 * @param {ImportResult} res
 */
function showImportSummary(name, res) {
  let added = 0;
  let updated = 0;
  let invalid = 0;
  /** @type {HTMLElement[]} */
  const rows = [];
  for (const [store, label] of STORE_LABELS) {
    const c = res.counts[store];
    if (!c || !(c.added + c.updated + c.skipped + c.invalid)) continue;
    added += c.added;
    updated += c.updated;
    invalid += c.invalid;
    const parts = [`${c.added} added`, `${c.updated} updated`, `${c.skipped} skipped`, c.invalid ? `${c.invalid} invalid` : ''];
    rows.push(h('dt', null, label), h('dd', null, parts.filter(Boolean).join(' · ')));
  }
  const s = sheet('Import finished', [
    h('p', null, added + updated
      ? `From ${name}: ${plural(added, 'record')} added and ${updated} updated.`
      : res.materialsAdded || res.answersChanged ? `From ${name}: no new records.`
        : `Nothing new in ${name}: this device already had the same or newer versions.`),
    rows.length ? h('dl', { class: 'facts' }, rows) : h('p', null, 'The backup holds no records.'),
    res.materialsAdded ? h('p', null, `${plural(res.materialsAdded, 'new material')} added to your materials list.`) : null,
    res.answersChanged ? h('p', null, `${plural(res.answersChanged, 'answer')} about what materials are changed, for the plan checks.`) : null,
    invalid ? h('div', { class: 'banner', role: 'alert' }, icon('alert'),
      h('div', { class: 'banner-body' },
        h('p', null, h('strong', null, `${plural(invalid, 'record')} not imported`), ' because they are not valid:'),
        h('ul', { class: 'small' }, res.errors.map((e) => h('li', null, e))),
        invalid > res.errors.length ? h('p', { class: 'small' }, 'Only the first problems are listed.') : null)) : null,
    h('p', { class: 'muted small' }, 'Import never deletes anything. Records are matched by id and the newer version wins; skipped records were already here in the same or a newer version, and records deleted more recently stay deleted.'),
    button('Done', { kind: 'primary', big: true, onClick: () => s.close() }),
  ]);
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @returns {HTMLElement}
 */
function importSection(ctx) {
  const input = /** @type {HTMLInputElement} */ (h('input', {
    type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true',
  }));
  const status = h('p', { class: 'field-note', role: 'status' });
  const choose = button('Choose backup file…', { icon: 'upload', big: true, onClick: () => input.click() });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    choose.disabled = true;
    status.textContent = `Importing ${file.name}…`;
    try {
      const res = await importBackupFile(file);
      status.textContent = `Imported ${file.name}.`;
      // Redraw first: a sheet closes when the screen redraws, and the summary must stay open.
      if (ctx.isCurrent()) refresh();
      showImportSummary(file.name, res);
    } catch (err) {
      status.textContent = '';
      toast(`Import failed: ${errorText(err)}`, { kind: 'error' });
    } finally {
      choose.disabled = false;
    }
  });
  return section('Import a backup',
    h('p', null, 'Merges a backup file into the data on this device, for example to bring runs logged on your phone to your PC.'),
    h('p', { class: 'muted small' }, 'Import never deletes anything and never wipes this device. Each record is matched by its id and the newer version wins, so newer edits made here are kept, and records deleted more recently stay deleted.'),
    input,
    choose,
    status);
}

/**
 * Projects that come with the app (data/shared-projects.js): each a backup
 * file of the app's own, added to this device with one tap, through the
 * same merge as an import.
 * @param {import('../router.js').ViewContext} ctx
 * @returns {Promise<HTMLElement>}
 */
async function sharedSection(ctx) {
  const rows = await Promise.all(SHARED_PROJECTS.map(async (sp) => ({ sp, have: !!(await getProject(sp.id)) })));
  const status = h('p', { class: 'field-note', role: 'status' });
  const add = (/** @type {import('../data/shared-projects.js').SharedProject} */ sp, /** @type {HTMLButtonElement} */ btn) => async () => {
    btn.disabled = true;
    status.textContent = `Adding ${sp.name}…`;
    try {
      // The app's own file (cached by the service worker, so it comes offline too), merged like a backup.
      const res = await fetch(`projects/${sp.file}`);
      if (!res.ok) throw new Error(`The project file could not be loaded (${res.status}).`);
      const r = await importBackupFile(new File([await res.text()], sp.file, { type: 'application/json' }));
      const c = r.counts.projects || { added: 0, updated: 0, skipped: 0, invalid: 0 };
      status.textContent = '';
      if (c.invalid) throw new Error(r.errors.join(' ') || 'The project file is not valid.');
      if (ctx.isCurrent()) refresh();
      toast(c.added ? `${sp.name} added. Find it under Projects.` : c.updated ? `${sp.name} brought up to date.` : `${sp.name} is already on this device.`,
        { action: { label: 'Open', fn: () => navigate(`/project/${encodeURIComponent(sp.id)}`) }, timeout: 10000 });
    } catch (err) {
      status.textContent = '';
      btn.disabled = false;
      toast(`Could not add ${sp.name}: ${errorText(err)}`, { kind: 'error' });
    }
  };
  return section('Projects that come with the app',
    h('p', null, 'Plans worked out in advance, with their wafers and steps. Add one to this device, then open it under Projects and start its steps. Adding it again changes nothing you edited.'),
    h('div', { class: 'list' }, rows.map(({ sp, have }) => {
      const btn = button('Add to this device', { icon: 'download' });
      btn.addEventListener('click', add(sp, btn));
      // The button sits under the text, so a long description keeps the row's width.
      return h('div', { class: 'row shared-row' },
        h('span', { class: 'row-lead' }, icon('project')),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, sp.name), h('span', { class: 'row-sub' }, sp.about),
          h('span', { class: 'shared-actions' },
            have ? linkButton('Open', `#/project/${encodeURIComponent(sp.id)}`, { kind: 'ghost', icon: 'chevron' }) : btn)));
    })),
    status,
    h('p', { class: 'muted small' }, 'These files live in the app’s repository under app/projects/, in the backup format, so they can also be imported by hand on any device.'));
}

/** @returns {HTMLElement} */
function storageSection() {
  const box = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Checking storage…'));
  const draw = async () => {
    const [st, photos] = await Promise.all([storageStatus(), photoUsage()]);
    const persisted = st.persisted === true ? badge('Yes', 'ok', 'check')
      : st.persisted === false ? badge('No', 'warn', 'alert') : badge('Unknown', 'muted');
    fill(box,
      h('dl', { class: 'facts' },
        h('dt', null, 'Space used'),
        h('dd', null, st.usage === null ? 'Not reported by this browser'
          : `${formatBytes(st.usage)}${st.quota ? ` of ${formatBytes(st.quota)} allowed` : ''}`),
        h('dt', null, 'Photos and files'),
        h('dd', null, photos.count ? `${storedFiles(photos.count)}, ${formatBytes(photos.bytes)}` : 'None'),
        h('dt', null, 'Persistent'),
        h('dd', null, persisted)),
      st.persisted === true ? h('p', { class: 'field-note' }, 'The browser will not clear this data on its own.') : null,
      st.persisted === false ? h('p', { class: 'field-note' }, 'The browser may clear this data when the device runs low on space.') : null,
      st.persisted === false ? button('Request persistent storage', {
        icon: 'check', big: true,
        onClick: async () => {
          const r = await requestPersist();
          toast(r === true ? 'Storage is now persistent.'
            : r === false ? 'The browser declined. Installing the app and using it often can help; keep exporting backups.'
              : 'This browser cannot make storage persistent.');
          await draw();
        },
      }) : null,
      h('p', { class: 'muted small' }, 'On iPhone and iPad, Safari can delete the data of websites you have not used for a while. The app added to the Home Screen gets more durable storage, but no browser storage is guaranteed: export a backup regularly.'));
  };
  draw().catch((err) => fill(box, h('p', { class: 'field-note warn' }, `Could not read the storage status: ${errorText(err)}`)));
  return section('Storage', box);
}

/** @returns {HTMLElement} */
function eraseSection() {
  const status = h('p', { class: 'field-note', role: 'status' });
  const erase = button('Erase all data…', {
    kind: 'danger', icon: 'trash', big: true,
    onClick: async () => {
      const ok = await confirmDialog({
        title: 'Erase all data on this device?',
        message: 'This deletes every tool, template, run, measurement, tool event, project, folder, photo and setting stored on this device. Backup files you exported are not touched. This cannot be undone.',
        confirmLabel: 'Erase everything',
        danger: true,
        word: UI.ERASE_WORD,
      });
      if (!ok) return;
      erase.disabled = true;
      status.textContent = 'Erasing…';
      try {
        await eraseAllData();
        window.location.reload();
      } catch (err) {
        erase.disabled = false;
        status.textContent = '';
        toast(`Could not erase: ${errorText(err)}`, { kind: 'error' });
      }
    },
  });
  return section('Erase all data',
    h('p', null, 'Removes everything this app stored on this device, projects included; it then starts again with the LNF tool list. Export a backup first.'),
    erase,
    status);
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Backup and data');
  const [settings, photos, photoEstimate, shared] = await Promise.all([getSettings(), photoUsage(), estimatePhotoBytes(), sharedSection(ctx)]);
  append(ctx.root, [
    backupSection(settings, photos, photoEstimate),
    everythingSection(),
    csvSection(),
    importSection(ctx),
    shared,
    storageSection(),
    eraseSection(),
  ]);
}
