// @ts-check
/**
 * Reusable components: buttons, toasts, confirm dialog, bottom sheet, list
 * rows, segmented choices, switches, badges and empty states. Selection
 * state is always shown with text or an icon as well as colour.
 */
import { h, on, uid } from './dom.js';
import { icon } from './icons.js';
import { UI } from '../config.js';

/**
 * A short, human message for an error (storage-full gets advice).
 * @param {unknown} err
 * @returns {string}
 */
export function errorText(err) {
  const e = /** @type {any} */ (err);
  if (e && e.name === 'QuotaExceededError') return 'Storage is full. Export a backup, then delete photos or old data.';
  return (e && e.message) || String(err);
}

/**
 * @typedef {Object} ButtonOpts
 * @property {'primary'|'secondary'|'danger'|'ghost'} [kind]
 * @property {string} [icon]
 * @property {(e: MouseEvent) => void} [onClick]
 * @property {boolean} [disabled]
 * @property {boolean} [big]
 * @property {string} [ariaLabel]
 * @property {string} [class]
 * @property {'button'|'submit'} [type]
 */

/**
 * @param {string} label visible text ("" for icon-only, then set ariaLabel)
 * @param {ButtonOpts} [o]
 * @returns {HTMLButtonElement}
 */
export function button(label, o = {}) {
  return /** @type {HTMLButtonElement} */ (h('button', {
    type: o.type || 'button',
    class: ['btn', `btn-${o.kind || 'secondary'}`, o.big && 'btn-big', !label && 'btn-icon', o.class],
    disabled: o.disabled,
    'aria-label': o.ariaLabel,
    onClick: o.onClick,
  }, o.icon ? icon(o.icon) : null, label ? h('span', null, label) : null));
}

/**
 * A link styled as a button.
 * @param {string} label
 * @param {string} href
 * @param {{kind?: string, icon?: string, big?: boolean, class?: string}} [o]
 * @returns {HTMLAnchorElement}
 */
export function linkButton(label, href, o = {}) {
  return /** @type {HTMLAnchorElement} */ (h('a', {
    href,
    class: ['btn', `btn-${o.kind || 'secondary'}`, o.big && 'btn-big', o.class],
  }, o.icon ? icon(o.icon) : null, h('span', null, label)));
}

/**
 * Show a toast. With an action (Undo, Reload) it stays for `timeout` ms
 * (default 5 s); timeout 0 keeps it until dismissed.
 * @param {string} message
 * @param {{action?: {label: string, fn: () => void}, timeout?: number, kind?: 'info'|'error'}} [o]
 * @returns {{close: () => void, el: HTMLElement | null}} el is the toast (null without a toast area)
 */
export function toast(message, o = {}) {
  const box = document.getElementById('toasts');
  if (!box) return { close() {}, el: null };
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.remove();
  };
  const el = h('div', { class: ['toast', o.kind === 'error' && 'toast-error'], role: o.kind === 'error' ? 'alert' : 'status' },
    o.kind === 'error' ? icon('alert') : null,
    h('span', { class: 'toast-msg' }, message),
    o.action ? button(o.action.label, {
      kind: 'ghost',
      class: 'toast-action',
      onClick: () => { close(); o.action?.fn(); },
    }) : null,
    button('', { kind: 'ghost', icon: 'close', ariaLabel: 'Dismiss', class: 'toast-close', onClick: close }));
  while (box.children.length >= 2) box.firstElementChild?.remove();
  box.append(el);
  const timeout = o.timeout ?? (o.kind === 'error' ? 8000 : UI.UNDO_MS);
  if (timeout > 0) timer = setTimeout(close, timeout);
  return { close, el };
}

/**
 * Ask for confirmation in a modal dialog. With `word`, the person must
 * type that word before Confirm is enabled.
 * @param {{title: string, message?: string, confirmLabel?: string, danger?: boolean, word?: string}} o
 * @returns {Promise<boolean>}
 */
export function confirmDialog(o) {
  return new Promise((resolve) => {
    const inputId = uid('confirm');
    const input = o.word ? /** @type {HTMLInputElement} */ (h('input', {
      id: inputId, type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', class: 'input',
    })) : null;
    const ok = button(o.confirmLabel || 'Confirm', { kind: o.danger ? 'danger' : 'primary', disabled: !!o.word });
    const cancel = button('Cancel', { kind: 'secondary' });
    const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'dialog', 'aria-labelledby': `${inputId}-t` },
      h('h2', { id: `${inputId}-t` }, o.title),
      o.message ? h('p', null, o.message) : null,
      input ? h('label', { for: inputId, class: 'label' }, `Type ${o.word} to confirm`) : null,
      input,
      h('div', { class: 'dialog-actions' }, cancel, ok)));
    let result = false;
    const finish = (/** @type {boolean} */ v) => { result = v; dlg.close(); };
    on(ok, 'click', () => finish(true));
    on(cancel, 'click', () => finish(false));
    if (input) on(input, 'input', () => { ok.disabled = input.value.trim().toUpperCase() !== o.word; });
    on(dlg, 'close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else { dlg.remove(); resolve(window.confirm(`${o.title}\n${o.message || ''}`)); return; }
    (input || cancel).focus();
  });
}

/** How long after a sheet opens, or a choice closes one, a tap is taken for the second half of a double tap. */
const DOUBLE_TAP_MS = 500;

/**
 * Let real taps do nothing for a moment: after a choice closes a sheet, the
 * second half of a double tap must not act on what is now under the finger
 * (a "Mark as checked" on the screen below).
 * @param {number} [ms]
 */
export function holdTaps(ms = DOUBLE_TAP_MS) {
  const until = performance.now() + ms;
  const swallow = (/** @type {Event} */ e) => {
    if (performance.now() > until) document.removeEventListener('click', swallow, true);
    else if (e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); }
  };
  document.addEventListener('click', swallow, true);
  setTimeout(() => document.removeEventListener('click', swallow, true), ms + 50);
}

/**
 * A bottom sheet (modal dialog) holding arbitrary content. It closes when
 * the app moves to another screen (an in-app link in it, Back, a refresh),
 * so it never stays open over a screen it does not belong to. Taps in its
 * first half second are taken for the end of the tap that opened it.
 * @param {string} title
 * @param {Node[]} content
 * @param {{onClose?: () => void}} [o]
 * @returns {{close: () => void, el: HTMLDialogElement}}
 */
export function sheet(title, content, o = {}) {
  const tid = uid('sheet');
  const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'dialog sheet', 'aria-labelledby': tid },
    h('div', { class: 'sheet-head' },
      h('h2', { id: tid }, title),
      button('', { kind: 'ghost', icon: 'close', ariaLabel: 'Close', onClick: () => dlg.close() })),
    h('div', { class: 'sheet-body', tabindex: '-1', autofocus: true }, content)));
  const leave = () => dlg.close();
  window.addEventListener('hashchange', leave);
  // A tap that lands just after the sheet opens is the second half of the tap that opened it (a double tap or a
  // double-click): it must not choose whatever is now under the finger.
  let opened = 0;
  dlg.addEventListener('click', (e) => {
    if (e.isTrusted && performance.now() - opened < DOUBLE_TAP_MS) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  on(dlg, 'close', () => { window.removeEventListener('hashchange', leave); dlg.remove(); o.onClose?.(); });
  on(dlg, 'click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  opened = performance.now();
  return { close: () => dlg.close(), el: dlg };
}

/**
 * A tappable list row (a link when href is given).
 * @param {{title: string, subtitle?: string | Node, meta?: string | Node, href?: string,
 *   onClick?: () => void, badges?: Node[], lead?: Node}} o
 * @returns {HTMLElement}
 */
export function listRow(o) {
  const body = [
    o.lead ? h('span', { class: 'row-lead' }, o.lead) : null,
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, o.title),
      o.subtitle ? h('span', { class: 'row-sub' }, o.subtitle) : null,
      o.badges && o.badges.length ? h('span', { class: 'row-badges' }, o.badges) : null),
    o.meta ? h('span', { class: 'row-meta' }, o.meta) : null,
    icon('chevron', { class: 'row-chev' }),
  ];
  return o.href
    ? h('a', { class: 'row', href: o.href }, body)
    : h('button', { type: 'button', class: 'row', onClick: o.onClick }, body);
}

/**
 * @param {string} text
 * @param {'info'|'ok'|'warn'|'danger'|'muted'|'brand'} [kind]
 * @param {string} [iconName]
 * @returns {HTMLElement}
 */
export function badge(text, kind = 'muted', iconName) {
  return h('span', { class: ['badge', `badge-${kind}`] }, iconName ? icon(iconName, { size: 16 }) : null, text);
}

/**
 * @param {string} text
 * @param {Node | null} [action]
 * @returns {HTMLElement}
 */
export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('p', null, text), action || null);
}

/**
 * A titled block of content.
 * @param {string | null} title
 * @param {...import('./dom.js').Child} children
 * @returns {HTMLElement}
 */
export function section(title, ...children) {
  return h('section', { class: 'section' }, title ? h('h2', { class: 'section-title' }, title) : null, children);
}

/**
 * A titled block whose title has an "i" button, for a choice that has no
 * label of its own (a row of tool tiles, a group of measurement points).
 * @param {string} title
 * @param {string | readonly string[]} help
 * @param {...import('./dom.js').Child} children
 * @returns {HTMLElement}
 */
export function helpSection(title, help, ...children) {
  const { btn, note } = helpToggle(title, help);
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, title), btn), note, children);
}

/**
 * A small "i" button that shows or hides a note about a field. Put `btn`
 * beside the field's label and `note` under the label row.
 * @param {string} name what the note is about, read out as "About <name>"
 * @param {string | readonly string[]} text one paragraph per string
 * @returns {{btn: HTMLButtonElement, note: HTMLElement}}
 */
export function helpToggle(name, text) {
  const id = uid('help');
  const note = h('div', { id, class: 'field-help', hidden: true },
    (typeof text === 'string' ? [text] : [...text]).map((p) => h('p', null, p)));
  const btn = /** @type {HTMLButtonElement} */ (h('button', {
    type: 'button', class: 'help-btn', 'aria-label': `About ${name}`, 'aria-expanded': 'false', 'aria-controls': id,
    onClick: () => {
      note.hidden = !note.hidden;
      btn.setAttribute('aria-expanded', String(!note.hidden));
    },
  }, icon('info', { size: 20 })));
  return { btn, note };
}

/**
 * A field's label row: the label with its "i" button, then any extra
 * controls (a Clear button) at the end of the row, and the note under it.
 * Without help it is the label (in a row with the extras, if any).
 * @param {HTMLElement} label the label element
 * @param {string} name read out as "About <name>"
 * @param {string | readonly string[] | null | undefined} help
 * @param {...import('./dom.js').Child} extra
 * @returns {HTMLElement[]}
 */
export function labelRow(label, name, help, ...extra) {
  const more = extra.filter(Boolean);
  if (!help || !help.length) return more.length ? [h('div', { class: 'field-head' }, label, more)] : [label];
  const { btn, note } = helpToggle(name, help);
  return [h('div', { class: 'field-head' }, h('span', { class: 'label-help' }, label, btn), more), note];
}

/**
 * One-of-n choice as big buttons (an ARIA radio group). The selected option
 * shows a check mark, so state never relies on colour alone. `help` adds an
 * "i" button beside the label.
 * @template T
 * @param {{label?: string, options: {value: T, label: string}[], value: T | null,
 *   onChange: (v: T | null) => void, allowNone?: boolean, compact?: boolean,
 *   help?: string | readonly string[]}} o
 * @returns {HTMLElement}
 */
export function segmented(o) {
  const labelId = uid('seg');
  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  let value = o.value;
  const sync = () => {
    o.options.forEach((opt, i) => {
      const sel = opt.value === value;
      buttons[i].setAttribute('aria-checked', String(sel));
      buttons[i].tabIndex = sel || (value === null && i === 0) ? 0 : -1;
    });
  };
  const pick = (/** @type {T | null} */ v) => {
    value = o.allowNone && v === value ? null : v;
    sync();
    o.onChange(value);
  };
  o.options.forEach((opt, i) => {
    const b = /** @type {HTMLButtonElement} */ (h('button', {
      type: 'button', role: 'radio', class: 'seg-btn', onClick: () => pick(opt.value),
      onKeydown: (/** @type {KeyboardEvent} */ e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const j = (i + d + o.options.length) % o.options.length;
        buttons[j].focus();
        pick(o.options[j].value);
      },
    }, icon('check', { size: 18, class: 'seg-check' }), h('span', null, opt.label)));
    buttons.push(b);
  });
  sync();
  return h('div', { class: ['seg', o.compact && 'seg-compact'] },
    o.label ? labelRow(h('span', { class: 'label', id: labelId }, o.label), o.label, o.help) : null,
    h('div', { class: 'seg-row', role: 'radiogroup', 'aria-labelledby': o.label ? labelId : undefined }, buttons));
}

/**
 * An on/off switch with a visible On/Off word. `help` adds an "i" button
 * beside the switch (the switch is a button, so it cannot hold one).
 * @param {{label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string,
 *   help?: string | readonly string[]}} o
 * @returns {HTMLElement}
 */
export function toggle(o) {
  let checked = o.checked;
  const state = h('span', { class: 'switch-state' }, checked ? 'On' : 'Off');
  const btn = h('button', {
    type: 'button', role: 'switch', class: 'switch', 'aria-checked': String(checked),
    onClick: () => {
      checked = !checked;
      btn.setAttribute('aria-checked', String(checked));
      state.textContent = checked ? 'On' : 'Off';
      o.onChange(checked);
    },
  }, h('span', { class: 'switch-text' }, h('span', { class: 'switch-label' }, o.label),
    o.hint ? h('span', { class: 'switch-hint' }, o.hint) : null),
  h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })), state);
  if (!o.help || !o.help.length) return btn;
  const info = helpToggle(o.label, o.help);
  return h('div', { class: 'switch-wrap' }, h('div', { class: 'switch-row' }, btn, info.btn), info.note);
}

/**
 * A small removable or tappable chip.
 * @param {string} text
 * @param {{onClick?: () => void, actionLabel?: string, icon?: string}} [o]
 * @returns {HTMLElement}
 */
export function chip(text, o = {}) {
  return h('span', { class: 'chip' }, o.icon ? icon(o.icon, { size: 18 }) : null, h('span', null, text),
    o.onClick ? h('button', { type: 'button', class: 'chip-action', onClick: o.onClick }, o.actionLabel || 'Clear') : null);
}
