// @ts-check
/**
 * My tools: the tools you use. Tool pickers show these (and any tool used in
 * the last weeks) first and keep the rest of the LNF list behind "All
 * tools". Grouped by category, with search; each tap saves at once. The
 * choice belongs to this device, like the theme.
 */
import { h, append, fill, uid } from '../ui/dom.js';
import { icon, categoryIcon } from '../ui/icons.js';
import { section, labelRow, button, emptyState } from '../ui/components.js';
import { getSettings, saveSettings, listTools } from '../data/repo.js';
import { CATEGORY_LABELS, TOOL_CATEGORIES, normText } from '../core/vocab.js';
import { HELP } from '../core/app-help.js';

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('My tools');
  const [tools, settings] = await Promise.all([listTools(), getSettings()]);
  const known = new Set(tools.map((t) => t.id));
  const mine = new Set((settings.myTools || []).filter((id) => known.has(id)));
  const count = h('p', { class: 'muted small', role: 'status' });
  const listBox = h('div', { class: 'stack' });
  let query = '';
  const save = () => saveSettings({ myTools: [...mine] });
  const drawCount = () => { count.textContent = `${mine.size} of ${tools.length} tools chosen.`; };
  const row = (/** @type {import('../core/types.js').Tool} */ t) => {
    const btn = h('button', {
      type: 'button', class: 'row tool-check', role: 'checkbox', 'aria-checked': String(mine.has(t.id)),
      onClick: () => {
        if (mine.has(t.id)) mine.delete(t.id);
        else mine.add(t.id);
        btn.setAttribute('aria-checked', String(mine.has(t.id)));
        drawCount();
        save();
      },
    }, h('span', { class: 'row-lead' }, categoryIcon(t.category)),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t.name)),
    h('span', { class: 'check-box', 'aria-hidden': 'true' }, icon('check', { size: 20 })));
    return btn;
  };
  const draw = () => {
    const want = normText(query);
    const shown = tools.filter((t) => !want || normText(`${t.name} ${t.shortName} ${CATEGORY_LABELS[t.category] || ''}`).includes(want));
    const groups = TOOL_CATEGORIES.map((c) => ({ c, list: shown.filter((t) => t.category === c) })).filter((g) => g.list.length);
    fill(listBox, groups.length
      ? groups.map((g) => section(`${CATEGORY_LABELS[g.c] || g.c} (${g.list.length})`, h('div', { class: 'list' }, g.list.map(row))))
      : emptyState('No tool matches.'));
  };
  const searchId = uid('mytools');
  const search = /** @type {HTMLInputElement} */ (h('input', {
    id: searchId, class: 'input', type: 'search', placeholder: 'Search tools', autocomplete: 'off', enterkeyhint: 'search',
  }));
  search.addEventListener('input', () => { query = search.value; draw(); });
  drawCount();
  draw();
  append(ctx.root, [
    h('p', null, 'Tap the tools you use. Tool pickers then show those first, with every other tool one tap away under All tools.'),
    h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: searchId }, 'Search tools'), 'My tools', HELP.myTools), search),
    count,
    listBox,
  ]);
  ctx.setActions([button('Done', {
    kind: 'primary', icon: 'check', big: true,
    onClick: () => { if (history.length > 1) history.back(); else location.hash = '#/settings'; },
  })]);
}
