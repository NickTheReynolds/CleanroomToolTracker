// @ts-check
/**
 * Settings -> Materials: the list the material and substrate pickers offer.
 * Search it, add to it, reorder it and remove entries (with Undo).
 */
import { h, fill, uid, append } from '../ui/dom.js';
import { button, toast, emptyState } from '../ui/components.js';
import { materialMatches } from '../ui/pickers.js';
import { getSettings, saveSettings } from '../data/repo.js';
import { normText } from '../core/vocab.js';

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Materials');
  let list = [...(await getSettings()).materials];
  const id = uid('mat');
  const input = /** @type {HTMLInputElement} */ (h('input', {
    id, class: 'input', type: 'search', placeholder: 'e.g. Pt, gold or a new name', autocomplete: 'off', enterkeyhint: 'done',
  }));
  const rows = h('div', { class: 'list' });
  const count = h('p', { class: 'muted small', role: 'status' });
  const save = async (/** @type {string[]} */ next) => {
    list = next;
    await saveSettings({ materials: next });
    draw();
  };
  const addTyped = () => {
    const name = input.value.trim();
    if (!name) return;
    if (list.some((m) => normText(m) === normText(name))) {
      toast(`${name} is already in the list.`);
      return;
    }
    input.value = '';
    save([...list, name]);
  };
  const add = button('Add', { kind: 'primary', icon: 'plus', onClick: addTyped });
  /**
   * @param {string} m
   * @param {number} i its index in the whole list
   * @param {boolean} filtered reordering is hidden while searching
   */
  const row = (m, i, filtered) => h('div', { class: 'row' },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, m)),
    filtered ? null : button('', {
      kind: 'ghost', icon: 'up', ariaLabel: `Move ${m} up`, disabled: i === 0,
      onClick: () => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n); },
    }),
    filtered ? null : button('', {
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
    }));
  const draw = () => {
    const filtered = !!input.value.trim();
    const shown = list.map((m, i) => ({ m, i })).filter(({ m }) => materialMatches(m, input.value));
    add.disabled = !filtered || list.some((m) => normText(m) === normText(input.value));
    count.textContent = filtered ? `${shown.length} of ${list.length} materials match.` : `${list.length} materials.`;
    fill(rows, shown.length
      ? shown.map(({ m, i }) => row(m, i, filtered))
      : emptyState(filtered ? 'No material matches. Tap Add to put it in the list.' : 'The list is empty.'));
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTyped(); });
  draw();
  append(ctx.root, [
    h('p', null, 'Offered in the material and substrate pickers, the ones you used recently first. It starts with what the LNF wiki lists as supported; add your own or remove ones you never use.'),
    h('div', { class: 'field' }, h('label', { class: 'label', for: id }, 'Find or add a material'),
      h('div', { class: 'stepper' }, input, add)),
    count,
    rows,
  ]);
}
