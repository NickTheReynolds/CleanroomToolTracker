// @ts-check
/**
 * Settings: name and device, links to my tools, tools and materials, data
 * and devices, theme, lookup tuning (under Advanced), version, updates and
 * the source code.
 */
import { h, uid, debounce, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, section, listRow, segmented, toast, labelRow } from '../ui/components.js';
import { textInput, numberStepper } from '../ui/fields.js';
import { applyTheme } from '../ui/theme.js';
import { checkForUpdate, updateWaiting, applyUpdate, desktopWrapper } from '../ui/pwa.js';
import { getSettings, saveSettings, listTools } from '../data/repo.js';
import { DEFAULTS, TUNABLE, SOURCE_URL } from '../config.js';
import { HELP, TUNING_HELP } from '../core/app-help.js';
import { APP_VERSION, APP_BUILD } from '../../version.js';

/** @typedef {import('../data/records.js').Settings} Settings */

/** Pending debounced saves, flushed when the view closes. */
/** @type {{flush: () => void}[]} */
let pending = [];

/**
 * @param {string} label
 * @param {string | null} value
 * @param {(v: string) => void} save
 * @param {string} [hint]
 * @param {string} [help] the note behind its "i" button
 */
function textSetting(label, value, save, hint, help) {
  const id = uid('set');
  const saveSoon = debounce(save, 400);
  pending.push(saveSoon);
  const input = textInput({ id, value, onChange: (v) => saveSoon(v || ''), autocapitalize: 'words' });
  return h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: id }, label), label, help), input.el,
    hint ? h('p', { class: 'field-note' }, hint) : null);
}

/**
 * Half-life, event penalty and top-K overrides with Reset to defaults.
 * @param {Settings} settings
 * @returns {HTMLElement}
 */
function tuningEditor(settings) {
  const box = h('div', { class: 'stack' });
  let tuning = { ...settings.tuning };
  const saveSoon = debounce(() => saveSettings({ tuning }), 400);
  pending.push(saveSoon);
  const draw = () => {
    box.replaceChildren(
      ...TUNABLE.map((t) => {
        const id = uid('tune');
        const value = typeof tuning[t.setting] === 'number' ? tuning[t.setting] : DEFAULTS[/** @type {keyof typeof DEFAULTS} */ (t.key)];
        const stepper = numberStepper({
          id, label: t.label, value, step: t.step, min: t.min, max: t.max,
          onChange: (v) => {
            if (v === null) delete tuning[t.setting];
            else tuning = { ...tuning, [t.setting]: v };
            saveSoon();
          },
        });
        return h('div', { class: 'field' },
          labelRow(h('label', { class: 'label', for: id }, t.label, t.unit ? h('span', { class: 'unit' }, ` (${t.unit})`) : null),
            t.label, TUNING_HELP[t.key]),
          stepper.el,
          h('p', { class: 'field-note' }, `Default ${DEFAULTS[/** @type {keyof typeof DEFAULTS} */ (t.key)]}. Allowed ${t.min}–${t.max}.`));
      }),
      button('Reset to defaults', {
        icon: 'undo',
        onClick: async () => {
          saveSoon.cancel();
          tuning = {};
          await saveSettings({ tuning });
          draw();
          toast('Lookup tuning reset to defaults.');
        },
      }));
  };
  draw();
  return box;
}

/** @returns {HTMLElement} copyright, license, source link and the not-affiliated note */
function licenseBlock() {
  return h('div', { class: 'stack' },
    h('p', { class: 'small' }, 'Copyright © 2026 Nick Reynolds. Free software under the GNU Affero General Public License, version 3 or later: you may use, share and change it, and copies and changed versions must stay under the same license with the source available. It comes with no warranty.'),
    SOURCE_URL ? h('p', { class: 'small' }, 'Source code: ', h('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener' }, SOURCE_URL)) : null,
    h('p', { class: 'small muted' }, 'An independent project, not made or endorsed by the University of Michigan or the Lurie Nanofabrication Facility.'));
}

/** @returns {HTMLElement} version, build and the update check */
function aboutBlock() {
  const wrapper = desktopWrapper();
  if (wrapper) {
    const name = wrapper.platform === 'macos' ? 'macOS' : 'Windows';
    return h('div', { class: 'stack' },
      h('p', null, `Version ${APP_VERSION}, ${name} desktop app${wrapper.version ? ` ${wrapper.version}` : ''}.`),
      h('p', { class: 'field-note' }, `To update, install the newer ${name} app over this one; your data is kept.`),
      licenseBlock());
  }
  const status = h('p', { class: 'field-note', role: 'status' }, updateWaiting() ? 'An update is ready.' : '');
  const messages = {
    available: 'An update is ready. Tap Reload in the message below.',
    downloading: 'Downloading the update…',
    current: 'You have the latest version.',
    offline: 'Could not reach the server. Try again when online.',
    unsupported: 'Updates need the service worker (use the HTTPS address or localhost).',
  };
  return h('div', { class: 'stack' },
    h('p', null, `Version ${APP_VERSION}`, APP_BUILD && APP_BUILD !== 'dev' ? ` (build ${APP_BUILD})` : ' (development)'),
    h('div', { class: 'row-wrap' },
      button('Check for update', {
        icon: 'download',
        onClick: async () => {
          status.textContent = 'Checking…';
          status.textContent = messages[await checkForUpdate()];
        },
      }),
      updateWaiting() ? button('Reload now', { kind: 'primary', onClick: () => applyUpdate() }) : null),
    status,
    licenseBlock());
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Settings');
  pending = [];
  const [settings, tools] = await Promise.all([getSettings(), listTools({ includeArchived: true })]);
  append(ctx.root, [
    section('You',
      textSetting('Your name', settings.userName, (v) => saveSettings({ userName: v }),
        'Recorded as the author of runs you log.', HELP.userName),
      textSetting('Device name', settings.deviceName, (v) => saveSettings({ deviceName: v }),
        'For example “Phone” or “Office PC”.', HELP.deviceName)),
    section('Tools and materials',
      h('div', { class: 'list' },
        listRow({
          title: 'My tools', lead: icon('star'),
          subtitle: (settings.myTools || []).length
            ? `${(settings.myTools || []).length} chosen. Tool pickers show these first.`
            : 'Choose the tools you use, so tool pickers show them first.',
          href: '#/settings/my-tools',
        }),
        listRow({
          title: 'Tools and templates', lead: icon('wrench'),
          subtitle: `${tools.filter((t) => t.active).length} active tools. Add, rename, archive, edit templates.`,
          href: '#/settings/tools',
        }),
        listRow({
          title: 'Materials', lead: icon('list'),
          subtitle: `${settings.materials.length} in the material and substrate pickers. Search, add, remove.`,
          href: '#/settings/materials',
        }))),
    section('Data and devices',
      h('div', { class: 'list' },
        listRow({
          title: 'Backup, import and storage', lead: icon('download'),
          subtitle: settings.lastExportAt ? `Last export ${new Date(settings.lastExportAt).toLocaleDateString()}` : 'No backup exported yet',
          href: '#/settings/data',
        }),
        listRow({
          title: 'Sync', lead: icon('sync'),
          subtitle: /** @type {any} */ (settings).sync && /** @type {any} */ (settings).sync.repo
            ? `With ${/** @type {any} */ (settings).sync.repo}` : 'Keep phones, computers and labmates in step through a private GitHub repository',
          href: '#/settings/sync',
        }),
        listRow({
          title: 'Install on your devices', lead: icon('share'),
          subtitle: 'Phone and computer install steps, with a QR code for the app address',
          href: '#/install',
        }))),
    section('Appearance',
      segmented({
        label: 'Theme', help: HELP.theme,
        options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
        value: settings.theme || 'system',
        onChange: async (v) => {
          const theme = v || 'system';
          applyTheme(theme);
          await saveSettings({ theme });
        },
      })),
    section('Advanced',
      h('details', { class: 'more' }, h('summary', null, 'Lookup tuning'),
        h('p', { class: 'muted small' }, 'How Lookup weighs older runs and tool events, and how many close runs it averages. The defaults suit most tools.'),
        tuningEditor(settings))),
    section('About', aboutBlock()),
  ]);
  const mine = pending;
  return () => mine.forEach((d) => d.flush());
}
