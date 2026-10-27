// @ts-check
/**
 * Settings → Tools → a tool → Compatibility: what the plan's checks know
 * about the tool. The sizes (which replace the LNF notes' size limits),
 * pieces, thickest wafer, mask plates and the materials not allowed can be
 * changed; the cleanliness rules show read only, with where they come from.
 * A change is stored on the tool (it syncs like the rest of the tool), and
 * Reset drops it.
 */
import { h, fill, uid } from './dom.js';
import { icon } from './icons.js';
import { button, section, segmented, labelRow } from './components.js';
import { numberStepper } from './fields.js';
import { refocusKey, keyed } from './wafer-spec-editor.js';
import { toolProfile, lnfFacts, LNF_COMPAT } from '../data/compat-lnf.js';
import { SIZES, CLASS_LABELS } from '../core/wafer-spec.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').ToolCompat} ToolCompat */

/** @type {Readonly<Record<string, string>>} */
const SOURCE = Object.freeze({ lnf: 'From the LNF wiki notes.', general: 'General practice.', yours: 'Your setting for this tool.' });
const PIECES = Object.freeze([['yes', 'Yes'], ['carrier', 'On a carrier'], ['ask', 'Ask staff first'], ['no', 'No']]);
/** The wet benches PFC Bench 01 takes wafers from (its own note); from any other, it takes none. */
const PFC_FROM = Object.values(LNF_COMPAT).find((f) => f.precleans)?.wetFrom || [];
/** @param {string} key @returns {string} "150 mm" */
const sizeShort = (key) => SIZES.find((s) => s.key === key)?.short || key;

/**
 * @param {{tool: Record<string, any>, onChange: (compat: ToolCompat | undefined) => void}} o
 *   tool: the tool as edited; onChange: the new settings, or undefined to use the LNF notes again
 * @returns {HTMLElement}
 */
export function compatSection(o) {
  /** @type {ToolCompat | undefined} */
  let compat = o.tool.compat ? { ...o.tool.compat } : undefined;
  const box = h('div', { class: 'stack' });
  const set = (/** @type {Partial<ToolCompat>} */ patch) => {
    compat = { ...(compat || {}), ...patch };
    o.onChange(compat);
    draw();
  };
  const chip = (/** @type {string} */ text, /** @type {boolean} */ on, /** @type {() => void} */ onClick, /** @type {string} */ id) => h('button', {
    type: 'button', class: 'pick-btn', 'aria-pressed': String(on), id, onClick,
  }, icon('check', { class: 'pick-check' }), text);
  const draw = () => {
    const focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : '';
    const focusedKey = document.activeElement && box.contains(document.activeElement)
      ? document.activeElement.closest('[data-key]')?.getAttribute('data-key') : null;
    const p = toolProfile(/** @type {Tool} */ ({ ...o.tool, compat }));
    const unset = (/** @type {string} */ k) => (p.src[k] === 'yours' ? 'Your setting: nothing is checked.' : 'Not set: nothing is checked.');
    const src = (/** @type {string} */ k) => h('p', { class: 'field-note' }, /** @type {any} */ (p)[k] === null || /** @type {any} */ (p)[k] === undefined
      ? unset(k) : SOURCE[p.src[k]] || '');
    const facts = lnfFacts(o.tool.id || '');
    const sizesId = uid('cs');
    const masksId = uid('cs');
    const exId = uid('cs');
    const thickId = 'compat-thick';
    // The LNF notes' size limits besides a list of sizes: "up to 150 mm", "150 mm needs a helpdesk ticket".
    const limits = [
      p.maxDiameterMm ? `Up to ${p.maxDiameterMm} mm. ${SOURCE[p.src.maxDiameterMm] || ''}` : '',
      p.askSizes ? `${p.askSizes.map(sizeShort).join(', ')}: ${p.askText || 'ask staff first'}. ${SOURCE[p.src.askSizes] || ''}` : '',
    ].filter(Boolean);
    const anySize = !p.sizes && !limits.length;
    const sizesNote = h('p', { class: 'field-note' }, [p.sizes ? SOURCE[p.src.sizes] || '' : '', ...limits].filter(Boolean).join(' ') || unset('sizes'));
    // The thinnest wafer it takes is an LNF fact with no box of its own: said under the thickest.
    const thin = p.minThicknessUm ? `Thinnest: ${p.minThicknessUm} µm. ${SOURCE[p.src.minThicknessUm] || ''}` : '';
    const thickText = (/** @type {number | null | undefined} */ max, /** @type {string} */ from) => (max === null || max === undefined
      ? (thin ? `${from === 'yours' ? 'Your setting: no upper limit.' : 'No upper limit.'} ${thin}` : (from === 'yours' ? 'Your setting: nothing is checked.' : 'Not set: nothing is checked.'))
      : [SOURCE[from] || '', thin].filter(Boolean).join(' '));
    const thickNote = h('p', { class: 'field-note' }, thickText(p.maxThicknessUm, p.src.maxThicknessUm || ''));
    const wafers = SIZES.filter((s) => !s.plate && s.key !== 'piece');
    const plates = SIZES.filter((s) => s.plate);
    const togg = (/** @type {string[] | null} */ cur, /** @type {string} */ k) => {
      const next = cur && cur.includes(k) ? cur.filter((x) => x !== k) : [...(cur || []), k];
      return next.length ? next : null;
    };
    /** @type {[string, string][]} */
    const readOnly = [];
    if (p.accepts) readOnly.push(['Takes wafers that are', `${p.accepts === 'clean' ? 'CMOS-clean only' : 'semi-clean or cleaner'}. ${SOURCE[p.src.accepts] || ''}`]);
    if (p.marks) readOnly.push(['Afterwards the wafers count as', `${p.marks === 'metals' ? 'not CMOS-clean, for good' : 'semi-clean (an RCA clean restores them)'}${p.marksWhy ? ` (${p.marksWhy})` : ''}. ${SOURCE[p.src.marks] || ''}`]);
    if (p.needsPreclean) readOnly.push(['Before it', `the RCA pre-furnace clean (PFC Bench 01) as the step right before. ${SOURCE[p.src.needsPreclean] || ''}`]);
    if (p.restores) {
      // Each part with its own source: what the clean does is the LNF's; what it cannot undo is partly general practice.
      readOnly.push(['Its clean', 'removes organic and ionic contaminants (LNF wiki notes). It does not make a metal-contaminated wafer CMOS-clean again: '
        + 'one that carries metal or has been in an evaporator, sputter or plating tool (general practice), or in the Metals-class tube (S6T1), '
        + 'the dicing saw, E-Beam Solvent Bench 22 or a non-CMOS solvent bench (LNF wiki notes).']);
    }
    if (p.substrates) readOnly.push(['Substrates', `${p.substrates.join(', ')} only. ${SOURCE[p.src.substrates] || ''}`]);
    if (p.carrier) readOnly.push(['Carrier wafer', `${sizeShort(p.carrier)} for smaller wafers and pieces. ${SOURCE[p.src.carrier] || ''}`]);
    if (p.wetBench && !PFC_FROM.includes(o.tool.id || '')) {
      readOnly.push(['Wet bench', `PFC Bench 01 takes no wafer whose last wet bench was this one, however many dry steps come between (only from Acid Bench 02 or RCA Bench 81). ${SOURCE[p.src.wetBench] || ''}`]);
    }
    const general = Object.values(p.src).includes('general');
    // Beyond the tool's own profile, every step gets the rules that follow the wafer.
    const always = 'and the rules that follow the wafer (KOH not yet cleaned off, mask plates, bonds)';
    fill(box,
      h('p', { class: 'muted small' }, facts ? `LNF wiki notes: ${facts.note}`
        : general ? `The app has no LNF notes for this tool. The checks use general practice for its kind of tool (below), what you set here ${always}.`
          : p.wetBench ? `The app has no LNF notes of its own for this tool. The checks know it is a wet bench (below), what you set here ${always}.`
            : `The app has no LNF notes for this tool. The checks use what you set here ${always}.`),
      h('div', { class: 'field' }, labelRow(h('span', { class: 'label', id: sizesId }, 'Wafer sizes it takes'), 'Wafer sizes it takes', HELP.toolSizes),
        h('div', { class: 'picker', role: 'group', 'aria-labelledby': sizesId },
          // The person's sizes (or none) replace the LNF notes' size limits too, so the screen says what is checked.
          chip('Any size (no check)', anySize, () => set({ sizes: null, maxDiameterMm: null, askSizes: null }), 'compat-size-any'),
          wafers.map((s) => chip(s.short, !!p.sizes && p.sizes.includes(s.key),
            () => set({ sizes: togg(p.sizes, s.key), maxDiameterMm: null, askSizes: null }), `compat-size-${s.key}`))),
        sizesNote),
      keyed(segmented({
        label: 'Pieces', compact: true, help: HELP.toolPieces, value: p.pieces || 'unset',
        options: [...PIECES.map(([value, label]) => ({ value, label })), { value: 'unset', label: 'Not set' }],
        onChange: (v) => set({ pieces: !v || v === 'unset' ? null : /** @type {ToolCompat['pieces']} */ (v) }),
      }), 'pieces'),
      h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: thickId }, 'Thickest wafer or stack (µm)'), 'Thickest wafer or stack', HELP.toolMaxThickness),
        numberStepper({
          id: thickId, label: 'thickest', value: p.maxThicknessUm, step: 100, min: 0, placeholder: null,
          onChange: (v) => {
            compat = { ...(compat || {}), maxThicknessUm: v };
            o.onChange(compat);
            // Say what the box now means without redrawing it under the person's typing.
            thickNote.textContent = thickText(v, 'yours');
          },
        }).el,
        thickNote),
      h('div', { class: 'field' }, labelRow(h('span', { class: 'label', id: masksId }, 'Mask plates it takes'), 'Mask plates it takes', HELP.toolMasks),
        h('div', { class: 'picker', role: 'group', 'aria-labelledby': masksId },
          chip('Any (no check)', !p.masks, () => set({ masks: null }), 'compat-mask-any'),
          plates.map((s) => chip(s.short, !!p.masks && p.masks.includes(s.key), () => set({ masks: togg(p.masks, s.key) }), `compat-mask-${s.key}`))),
        src('masks')),
      h('div', { class: 'field' }, labelRow(h('span', { class: 'label', id: exId }, 'Not allowed in it'), 'Not allowed in it', HELP.toolExcludes),
        h('div', { class: 'picker', role: 'group', 'aria-labelledby': exId },
          Object.entries(CLASS_LABELS).map(([k, label]) => chip(label, !!p.excludes && p.excludes.includes(k), () => set({ excludes: togg(p.excludes, k) }), `compat-ex-${k}`))),
        src('excludes')),
      readOnly.length ? h('dl', { class: 'facts' }, readOnly.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])) : null,
      compat ? button(facts ? 'Reset to the LNF notes' : general ? 'Reset to general practice' : 'Clear my settings', {
        icon: 'undo',
        onClick: () => {
          compat = undefined;
          o.onChange(undefined);
          draw();
          // The button is gone now: focus goes to the section's first control.
          /** @type {HTMLElement | null} */ (box.querySelector('#compat-size-any'))?.focus();
        },
      }) : null);
    if (focused) /** @type {HTMLElement | null} */ (box.querySelector(`#${CSS.escape(focused)}`))?.focus();
    else refocusKey(box, focusedKey);
  };
  draw();
  return section('Compatibility', h('p', { class: 'muted small' }, 'What the plan’s checks know about this tool. The LNF’s own rules and the tool engineer come first.'), box);
}
