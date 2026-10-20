// @ts-check
/**
 * Settings: name and device, tools and templates, materials, lookup tuning,
 * data and storage, theme, version and updates.
 */
import { h, uid, debounce, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, section, listRow, segmented, toast } from '../ui/components.js';
import { textInput, numberStepper } from '../ui/fields.js';
import { applyTheme } from '../ui/theme.js';
import { checkForUpdate, updateWaiting, applyUpdate, desktopWrapper } from '../ui/pwa.js';
import { getSettings, saveSettings, listTools } from '../data/repo.js';
import { DEFAULTS, TUNABLE } from '../config.js';
import { APP_VERSION, APP_BUILD } from '../../version.js';
import { normText } from '../core/vocab.js';

/** @typedef {import('../data/records.js').Settings} Settings */

/** Pending debounced saves, flushed when the view closes. */
/** @type {{flush: () => void}[]} */
let pending = [];

/**
 * @param {string} label
 * @param {string | null} value
 * @param {(v: string) => void} save
 * @param {string} [hint]
 */
function textSetting(label, value, save, hint) {
  const id = uid('set');
  const saveSoon = debounce(save, 400);
  pending.push(saveSoon);
  const input = textInput({ id, value, onChange: (v) => saveSoon(v || ''), autocapitalize: 'words' });
  return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), input.el,
    hint ? h('p', { class: 'field-note' }, hint) : null);
}

/**
 * Editable materials list: reorder, remove (with Undo) and add.
 * @param {Settings} settings
 * @returns {HTMLElement}
 */
function materialsEditor(settings) {
  let list = [...settings.materials];
  const box = h('div', { class: 'stack' });
  const save = async (/** @type {string[]} */ next) => {
    list = next;
    await saveSettings({ materials: next });
    draw();
  };
  const addId = uid('mat');
  const input = /** @type {HTMLInputElement} */ (h('input', {
    id: addId, class: 'input', type: 'text', placeholder: 'e.g. Pt', autocomplete: 'off', enterkeyhint: 'done',
  }));
  const add = () => {
    const name = input.value.trim();
    if (!name) return;
    if (list.some((m) => normText(m) === normText(name))) {
      toast(`${name} is already in the list.`);
      return;
    }
    input.value = '';
    save([...list, name]);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  const draw = () => {
    box.replaceChildren(
      h('div', { class: 'list' }, list.map((m, i) => h('div', { class: 'row' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, m)),
        button('', {
          kind: 'ghost', icon: 'up', ariaLabel: `Move ${m} up`, disabled: i === 0,
          onClick: () => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n); },
        }),
        button('', {
          kind: 'ghost', icon: 'down', ariaLabel: `Move ${m} down`, disabled: i === list.length - 1,
          onClick: () => { const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; save(n); },
        }),
        button('', {
          kind: 'ghost', icon: 'trash', ariaLabel: `Remove ${m}`,
          onClick: () => {
            const before = list;
            save(list.filter((_, j) => j !== i));
            toast(`Removed ${m}.`, { action: { label: 'Undo', fn: () => save(before) } });
          },
        })))),
      h('div', { class: 'field' }, h('label', { class: 'label', for: addId }, 'Add material'),
        h('div', { class: 'stepper' }, input, button('Add', { kind: 'primary', icon: 'plus', onClick: add }))));
  };
  draw();
  return box;
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
          h('label', { class: 'label', for: id }, t.label, t.unit ? h('span', { class: 'unit' }, ` (${t.unit})`) : null),
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

/** @returns {HTMLElement} version, build and the update check */
function aboutBlock() {
  const wrapper = desktopWrapper();
  if (wrapper) {
    const name = wrapper.platform === 'macos' ? 'macOS' : 'Windows';
    return h('div', { class: 'stack' },
      h('p', null, `Version ${APP_VERSION}, ${name} desktop app${wrapper.version ? ` ${wrapper.version}` : ''}.`),
      h('p', { class: 'field-note' }, `To update, install the newer ${name} app over this one; your data is kept.`));
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
    status);
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Settings');
  pending = [];
  const [settings, tools] = await Promise.all([getSettings(), listTools({ includeArchived: true })]);
  append(ctx.root, [
    section('You',
      textSetting('Your name', settings.userName, (v) => saveSettings({ userName: v }),
        'Recorded as the author of runs you log.'),
      textSetting('Device name', settings.deviceName, (v) => saveSettings({ deviceName: v }),
        'For example “Phone” or “Office PC”.')),
    section('Tools and templates',
      h('div', { class: 'list' },
        listRow({
          title: 'Tools and templates', lead: icon('wrench'),
          subtitle: `${tools.filter((t) => t.active).length} active tools. Add, rename, archive, edit templates.`,
          href: '#/settings/tools',
        }))),
    section('Materials', h('p', { class: 'muted small' }, 'Shown in the material and substrate pickers; the ones you used recently come first.'),
      materialsEditor(settings)),
    section('Lookup tuning', tuningEditor(settings)),
    section('Data and devices',
      h('div', { class: 'list' },
        listRow({
          title: 'Backup, import and storage', lead: icon('download'),
          subtitle: settings.lastExportAt ? `Last export ${new Date(settings.lastExportAt).toLocaleDateString()}` : 'No backup exported yet',
          href: '#/settings/data',
        }),
        listRow({
          title: 'Install on your devices', lead: icon('share'),
          subtitle: 'Phone and computer install steps, with a QR code for the app address',
          href: '#/install',
        }))),
    section('Appearance',
      segmented({
        label: 'Theme',
        options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
        value: settings.theme || 'system',
        onChange: async (v) => {
          const theme = v || 'system';
          applyTheme(theme);
          await saveSettings({ theme });
        },
      })),
    section('About', aboutBlock()),
  ]);
  const mine = pending;
  return () => mine.forEach((d) => d.flush());
}
