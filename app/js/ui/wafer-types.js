// @ts-check
/**
 * Wafer types on screen: the list a project picks a type from (your saved
 * types, then the LNF store's items), the sheet that shows a store item,
 * and the Add wafers sheet (kind, how many, which type).
 */
import { h, fill, uid } from './dom.js';
import { icon } from './icons.js';
import { button, sheet, segmented, labelRow, badge, toggle } from './components.js';
import { numberStepper } from './fields.js';
import { specEditor } from './wafer-spec-editor.js';
import { LNF_STORE } from '../data/lnf-store.js';
import { specShort, specSummary, isMask, cleanSpec, specEmpty, KIND_LABELS } from '../core/wafer-spec.js';
import { formatDay } from '../core/time.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').SavedWafer} SavedWafer */
/** @typedef {import('../core/types.js').WaferSpec} WaferSpec */
/** @typedef {import('../data/lnf-store.js').StoreItem} StoreItem */
/**
 * A type to give wafers: a copy of its spec and where it came from; null spec is "Not set".
 * @typedef {{spec: WaferSpec | null, specId: string | null, name: string}} TypeChoice
 */

/** @param {number} n */
const money = (n) => `$${n.toFixed(2)}`;

/**
 * The store's price line: "$46.90, seen Oct 22, 2026. Prices change; stock is not shown."
 * @param {StoreItem} item
 * @returns {string}
 */
export function priceText(item) {
  return `${money(item.price)}, seen ${formatDay(`${item.priceSeen}T12:00:00Z`, 0)}. Prices change; stock is not shown.`;
}

/**
 * What a store item is, as a sheet: the store's own name and text, the
 * price with the day it was seen, and the spec. "Copy to your types" saves
 * an editable copy.
 * @param {StoreItem} item
 * @param {{onCopy?: () => void, onUse?: () => void, useLabel?: string}} [o]
 */
export function openStoreItem(item, o = {}) {
  const s = sheet('LNF store item', [
    h('p', null, h('strong', null, item.storeName)),
    item.storeText ? h('p', { class: 'pre-line' }, item.storeText) : null,
    h('p', { class: 'muted small' }, priceText(item)),
    h('dl', { class: 'facts' }, [['What it is', specSummary(item.spec) || 'Not stated']].map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    item.spec.notes ? h('p', { class: 'muted small' }, item.spec.notes) : null,
    h('p', { class: 'muted small' }, 'From the LNF store’s page as seen on that day. The details hold what the store states (its doped wafers are silicon); anything else says where it comes from.'),
    h('div', { class: 'row-wrap' },
      o.onUse ? button(o.useLabel || 'Use this type', { kind: 'primary', icon: 'check', onClick: () => { s.close(); o.onUse?.(); } }) : null,
      o.onCopy ? button('Copy to your types', { icon: 'copy', onClick: () => { s.close(); o.onCopy?.(); } }) : null),
  ]);
}

/**
 * The rows of a type list: "Not set", your types, then the LNF store's.
 * @param {{saved: SavedWafer[], kind: 'wafer' | 'mask', current: string | null, onPick: (t: TypeChoice) => void, noneLabel?: string}} o
 *   current: the specId shown as chosen ('' for Not set)
 * @returns {HTMLElement}
 */
export function typeList(o) {
  const mine = o.saved.filter((w) => (o.kind === 'mask') === isMask(w));
  const store = LNF_STORE.filter((x) => (o.kind === 'mask') === (x.spec.kind === 'mask'));
  const row = (/** @type {string} */ id, /** @type {string} */ title, /** @type {string} */ subtitle, /** @type {() => void} */ pick) => h('button', {
    type: 'button', class: 'row', role: 'radio', 'aria-checked': String(o.current === id), onClick: pick,
  }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), subtitle ? h('span', { class: 'row-sub' }, subtitle) : null),
  h('span', { class: 'check-box', 'aria-hidden': 'true' }, icon('check', { size: 20 })));
  return h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Type' },
    h('div', { class: 'list' }, row('', o.noneLabel || 'Not set', 'Say what they are later, or not at all', () => o.onPick({ spec: null, specId: null, name: '' }))),
    mine.length ? h('h3', { class: 'section-title' }, `Your types (${mine.length})`) : null,
    mine.length ? h('div', { class: 'list' }, mine.map((w) => row(w.id, w.name, specShort(w.spec),
      () => o.onPick({ spec: w.spec, specId: w.id, name: w.name })))) : null,
    h('h3', { class: 'section-title' }, `LNF store (${store.length})`),
    h('div', { class: 'list' }, store.map((x) => row(x.id, x.storeName, [specShort(x.spec), money(x.price)].filter(Boolean).join(' · '),
      () => o.onPick({ spec: { ...x.spec }, specId: x.id, name: x.storeName })))));
}

/**
 * The Add wafers sheet: wafers or masks, how many, and their type. The last
 * type used is chosen at first.
 * @param {{saved: SavedWafer[], lastType?: TypeChoice | null, onAdd: (count: number, kind: 'wafer' | 'mask', type: TypeChoice) => void}} o
 */
export function openAddWafers(o) {
  /** @type {'wafer' | 'mask'} */
  let kind = o.lastType?.spec?.kind === 'mask' ? 'mask' : 'wafer';
  let count = 1;
  /** @type {TypeChoice} */
  let type = o.lastType || { spec: null, specId: null, name: '' };
  const listSlot = h('div');
  const go = button('Add 1 wafer', { kind: 'primary', icon: 'plus', big: true, onClick: () => { s.close(); o.onAdd(count, kind, type); } });
  const label = () => {
    const words = kind === 'mask' ? (count === 1 ? 'mask' : 'masks') : (count === 1 ? 'wafer' : 'wafers');
    /** @type {HTMLElement} */ (go.querySelector('span')).textContent = `Add ${count} ${words}`;
  };
  const drawList = (/** @type {boolean} */ refocus = false) => {
    fill(listSlot, typeList({
      saved: o.saved, kind, current: type.specId ?? '',
      onPick: (t) => { type = t; drawList(true); },
    }));
    label();
    // The list was redrawn under the person's finger: stay on the chosen row.
    if (refocus) /** @type {HTMLElement | null} */ (listSlot.querySelector('[role="radio"][aria-checked="true"]'))?.focus();
  };
  const countId = uid('count');
  const stepper = numberStepper({ id: countId, label: 'how many', value: count, step: 1, min: 1, max: 50, onChange: (v) => { count = Math.max(1, Math.min(50, v || 1)); label(); } });
  const typeId = uid('type');
  const s = sheet('Add wafers', [
    segmented({
      label: 'Add', value: kind, help: HELP.specKind, options: [{ value: 'wafer', label: 'Wafers' }, { value: 'mask', label: 'Masks' }],
      onChange: (v) => { kind = v === 'mask' ? 'mask' : 'wafer'; if ((type.spec?.kind === 'mask') !== (kind === 'mask')) type = { spec: null, specId: null, name: '' }; drawList(); },
    }),
    h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: countId }, 'How many'), 'How many', HELP.addWaferCount), stepper.el,
      h('div', { class: 'picker' }, [1, 2, 4, 8, 25].map((n) => button(String(n), { kind: 'ghost', ariaLabel: `${n}`, onClick: () => stepper.set(n) })))),
    h('div', { class: 'field' }, labelRow(h('span', { class: 'label', id: typeId }, 'Type'), 'Type', HELP.addWaferType), listSlot),
    h('div', { class: 'sheet-actions' }, go),
  ]);
  drawList();
}

/**
 * A project wafer's type: pick one of yours or an LNF store item (for the
 * other wafers without a type too, if wanted), or edit the details and
 * save them as a new type.
 * @param {{wafer: import('../core/types.js').Wafer, others: import('../core/types.js').Wafer[], saved: SavedWafer[],
 *   materials: string[], onAddMaterial?: (name: string) => void,
 *   onApply: (ids: string[], spec: WaferSpec | null, specId: string | null) => void,
 *   onSaveType: (spec: WaferSpec) => Promise<void>}} o
 */
export function openWaferType(o) {
  const kind = isMask(o.wafer) ? 'mask' : 'wafer';
  const kindSpec = kind === 'mask' ? { kind: /** @type {'mask'} */ ('mask') } : {};
  let also = o.others.length > 0;
  const openDetails = () => {
    /** @type {WaferSpec} */
    let spec = { ...(o.wafer.spec || {}), ...kindSpec };
    const d = sheet(`${o.wafer.label}: details`, [
      specEditor({ spec, materials: o.materials, onAddMaterial: o.onAddMaterial, onChange: (s) => { spec = s; } }),
      h('div', { class: 'sheet-actions row-wrap' },
        button('Done', {
          kind: 'primary', icon: 'check',
          onClick: () => {
            d.close();
            // Nothing filled in: the wafer stays without a type (a mask stays a mask).
            const clean = cleanSpec(spec);
            o.onApply([o.wafer.id], specEmpty(clean) ? (kind === 'mask' ? { kind: 'mask' } : null) : clean, specEmpty(clean) ? null : o.wafer.specId || null);
          },
        }),
        button('Save as a wafer type', { icon: 'plus', onClick: () => { o.onSaveType(cleanSpec(spec)); } })),
    ]);
  };
  const sh = sheet(`${o.wafer.label}: what it is`, [
    o.others.length ? toggle({
      label: o.others.length === 1 ? `Also for the other ${kind} without a type` : `Also for the ${o.others.length} other ${kind}s without a type`,
      checked: also, onChange: (v) => { also = v; },
      help: HELP.typeForOthers,
    }) : null,
    typeList({
      saved: o.saved, kind, current: specEmpty(o.wafer.spec) ? '' : (o.wafer.specId || null),
      onPick: (t) => {
        sh.close();
        const ids = [o.wafer.id, ...(also ? o.others.map((x) => x.id) : [])];
        o.onApply(ids, t.spec ? { ...t.spec, ...kindSpec } : kind === 'mask' ? { kind: 'mask' } : null, t.specId);
      },
    }),
    h('div', { class: 'sheet-actions' }, button('Edit the details', { icon: 'edit', onClick: () => { sh.close(); openDetails(); } })),
  ]);
}

/**
 * A wafer's type as one button: its summary, or "Set type (optional)".
 * @param {{spec?: WaferSpec | null}} w
 * @param {() => void} onClick
 * @param {string} ariaLabel
 * @returns {HTMLButtonElement}
 */
export function typeButton(w, onClick, ariaLabel) {
  const text = specShort(w.spec) || 'Set type (optional)';
  return button(text, { kind: 'ghost', icon: isMask(/** @type {any} */ (w)) ? 'layers' : 'wafer', ariaLabel, onClick });
}

/**
 * A badge saying an item is a mask, for lists.
 * @param {SavedWafer} w
 * @returns {HTMLElement | null}
 */
export function maskBadge(w) {
  return isMask(w) ? badge(KIND_LABELS.mask, 'info', 'layers') : null;
}
