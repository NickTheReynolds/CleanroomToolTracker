// @ts-check
/**
 * Settings -> Materials: the list the material and substrate pickers offer.
 * Search it, add to it, reorder it and remove entries (with Undo). Each
 * entry says what the plan checks make of it; one they do not know, or one
 * with an answer, can be tapped to say (or change) what it is.
 */
import { h, fill, uid, append } from '../ui/dom.js';
import { button, toast, emptyState, labelRow } from '../ui/components.js';
import { materialMatches } from '../ui/pickers.js';
import { chooseMaterialKind } from '../ui/material-kind.js';
import { refresh } from '../router.js';
import { getSettings, saveSettings, saveMaterialKind, restoreMaterialKind } from '../data/repo.js';
import { kindOf, materialReading, unknownParts } from '../core/wafer-spec.js';
import { normText } from '../core/vocab.js';
import { HELP } from '../core/app-help.js';

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Materials');
  const first = await getSettings();
  let list = [...first.materials];
  let kinds = first.materialKinds || {};
  const id = uid('mat');
  const input = /** @type {HTMLInputElement} */ (h('input', {
    id, class: 'input', type: 'search', placeholder: 'e.g. Pt, gold or a new name', autocomplete: 'off', enterkeyhint: 'done',
  }));
  const rows = h('div', { class: 'list' });
  const count = h('p', { class: 'muted small', role: 'status' });
  /** Read the list and the answers again (after an answer, or its Undo), keeping focus on the material's row. */
  const reload = async (/** @type {string} */ name = '') => {
    // An Undo tapped after leaving this screen: show the screen now open afresh.
    if (!ctx.isCurrent()) { refresh(); return; }
    const s = await getSettings();
    list = [...s.materials];
    kinds = s.materialKinds || {};
    draw();
    const j = name ? list.findIndex((m) => normText(m) === normText(name)) : -1;
    const row = j >= 0 ? rows.querySelector(`[data-row="${j}"]`) : null;
    /** @type {HTMLElement | null} */ (row ? row.querySelector('button:not([disabled])') : input)?.focus();
  };
  const save = async (/** @type {string[]} */ next) => {
    list = next;
    await saveSettings({ materials: next });
    draw();
  };
  /**
   * Move a material up or down in the list as it is stored now (a sync may have added to it meanwhile).
   * @param {string} m
   * @param {number} d -1 up, 1 down
   */
  const move = async (m, d) => {
    const now = [...(await getSettings()).materials];
    const i = now.findIndex((x) => normText(x) === normText(m));
    if (i < 0 || i + d < 0 || i + d >= now.length) return;
    [now[i], now[i + d]] = [now[i + d], now[i]];
    await save(now);
  };
  const addTyped = async () => {
    const name = input.value.trim();
    if (!name) return;
    // The list as it is stored now (a sync may have added to it meanwhile).
    const now = (await getSettings()).materials;
    if (now.some((m) => normText(m) === normText(name))) {
      toast(`${name} is already in the list.`);
      return;
    }
    input.value = '';
    await save([...now, name]);
  };
  const add = button('Add', { kind: 'primary', icon: 'plus', onClick: addTyped });
  /**
   * @param {string} m
   * @param {number} i its index in the whole list
   * @param {boolean} filtered reordering is hidden while searching
   * @param {string} after the row shown next (or before), for focus once this one is removed
   */
  const row = (m, i, filtered, after) => {
    const r = materialReading(m, kinds);
    const answered = !!kindOf(m, kinds);
    // What to ask about: the material of the name the checks do not know ("PZT" in "Ti/PZT"), else the name.
    const ask = r.known ? [] : unknownParts(m, kinds);
    const whole = ask.length === 1 && normText(ask[0]) === normText(m);
    const sub = !r.known ? `Checks: ${whole ? 'not known' : `do not know ${ask.join(' and ')}`}. Tap to say what it is.`
      : `Checks: ${r.text}${r.said ? ' (with your answer)' : ''}.${r.wafer ? ` As a wafer: ${r.wafer} (your answer).` : ''}`;
    const main = [h('span', { class: 'row-title' }, m), h('span', { class: 'row-sub' }, sub)];
    return h('div', { class: 'row', 'data-row': String(i) },
      // One the checks do not know, or one with an answer: tap to say (or change) what it is.
      !r.known || answered
        ? h('button', { type: 'button', class: 'row-main row-tap', onClick: () => chooseMaterialKind({ name: ask[0] || m, onSaved: () => reload(m) }) }, main)
        : h('span', { class: 'row-main' }, main),
      filtered ? null : button('', { kind: 'ghost', icon: 'up', ariaLabel: `Move ${m} up`, disabled: i === 0, onClick: () => move(m, -1) }),
      filtered ? null : button('', { kind: 'ghost', icon: 'down', ariaLabel: `Move ${m} down`, disabled: i === list.length - 1, onClick: () => move(m, 1) }),
      button('', {
        kind: 'ghost', icon: 'trash', ariaLabel: `Remove ${m}`,
        onClick: async () => {
          const s = await getSettings();
          const key = normText(m);
          const next = s.materials.filter((x) => normText(x) !== key);
          // A removed material takes its answer with it, so no hidden answer stays behind.
          const before = s.materialKinds && Object.hasOwn(s.materialKinds, key) ? { ...s.materialKinds[key] } : null;
          const wrote = kindOf(m, s.materialKinds) ? (await saveMaterialKind(m, '', { list: next })).materialKinds[key] || null : null;
          if (!wrote) await saveSettings({ materials: next });
          await reload(after);
          toast(`Removed ${m}.`, {
            action: {
              label: 'Undo',
              fn: async () => {
                // Back into the list as it is now (another Undo may have run since), where it was; the answer as it
                // was, unless it changed since.
                const now = (await getSettings()).materials;
                const back = now.some((x) => normText(x) === key) ? now : [...now.slice(0, i), m, ...now.slice(i)];
                if (wrote) await restoreMaterialKind(m, before, { list: back, expect: wrote }); else await saveSettings({ materials: back });
                await reload(m);
              },
            },
          });
        },
      }));
  };
  const draw = () => {
    const filtered = !!input.value.trim();
    const shown = list.map((m, i) => ({ m, i })).filter(({ m }) => materialMatches(m, input.value));
    add.disabled = !filtered || list.some((m) => normText(m) === normText(input.value));
    const unknown = list.filter((m) => !materialReading(m, kinds).known).length;
    count.textContent = `${filtered ? `${shown.length} of ${list.length} materials match.` : `${list.length} materials.`}${unknown ? ` The checks do not know ${unknown} of them.` : ''}`;
    fill(rows, shown.length
      ? shown.map(({ m, i }, k) => row(m, i, filtered, (shown[k + 1] || shown[k - 1] || { m: '' }).m))
      : emptyState(filtered ? 'No material matches. Tap Add to put it in the list.' : 'The list is empty.'));
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTyped(); });
  draw();
  append(ctx.root, [
    h('p', null, 'Offered in the material and substrate pickers, the ones you used recently first. It starts with what the LNF wiki lists as supported; add your own or remove ones you never use. Each says what the plan checks make of it: tap one they do not know to say what it is.'),
    h('div', { class: 'field' },
      labelRow(h('label', { class: 'label', for: id }, 'Find or add a material'), 'finding or adding a material', HELP.findMaterial),
      h('div', { class: 'stepper' }, input, add)),
    count,
    rows,
  ]);
}
