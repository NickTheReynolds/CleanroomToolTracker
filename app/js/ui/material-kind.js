// @ts-check
/**
 * "What is PZT?": the person says what a material the app does not know is,
 * so the plan checks can use it in every project and on every device that
 * syncs. For a film the app knows that is used as a wafer (an SiO2 wafer,
 * which could be fused silica), it asks what kind of wafer it is instead.
 * Asked from a plan note and from Settings → Materials. An answer only fills
 * in what the app does not know; it never takes away what it reads. A name
 * given an answer joins the materials list; Undo puts back the answer (and
 * the list) from before.
 */
import { h } from './dom.js';
import { button, sheet, toast, errorText, holdTaps } from './components.js';
import { getSettings, saveMaterialKind, restoreMaterialKind } from '../data/repo.js';
import {
  MATERIAL_KINDS, MATERIAL_KIND_LABELS, MATERIAL_KIND_SHORT, WAFER_KINDS, WAFER_KIND_LABELS, kindOf, materialKnown,
} from '../core/wafer-spec.js';
import { normText } from '../core/vocab.js';

/** @typedef {import('../core/wafer-spec.js').MaterialKind} MaterialKind */

/**
 * Ask what a material is and store the answer.
 * @param {{name: string, onSaved?: () => void}} o onSaved: after the answer, or its Undo, is stored
 * @returns {Promise<void>}
 */
export async function chooseMaterialKind(o) {
  const name = String(o.name || '').trim();
  if (!name) return;
  const s = await getSettings();
  const key = normText(name);
  const current = kindOf(name, s.materialKinds);
  const before = s.materialKinds && Object.hasOwn(s.materialKinds, key) ? { ...s.materialKinds[key] } : null;
  const listed = s.materials.some((m) => normText(m) === key);
  // A film the app knows (SiO2): the question is what kind of wafer it makes.
  const wafer = materialKnown(name);
  const choices = wafer ? WAFER_KINDS : MATERIAL_KINDS;
  const label = (/** @type {MaterialKind} */ k) => (wafer ? WAFER_KIND_LABELS[k] : MATERIAL_KIND_LABELS[k]) || k;
  const short = (/** @type {MaterialKind} */ k) => (wafer && k === 'dielectric' ? 'something else' : MATERIAL_KIND_SHORT[k]);
  /** @param {string} kind @param {import('../core/types.js').MaterialKindEntry | null} wrote what the answer stored */
  const undo = async (kind, wrote) => {
    const fresh = await getSettings();
    // A name that joined the list with this answer leaves it again.
    const list = kind && !listed ? fresh.materials.filter((m) => normText(m) !== key) : undefined;
    await restoreMaterialKind(name, before, { ...(list ? { list } : {}), expect: wrote });
    o.onSaved?.();
  };
  const pick = async (/** @type {string} */ kind) => {
    // The second half of a double tap must not land on the screen below.
    holdTaps();
    sh.close();
    /** @type {import('../core/types.js').MaterialKindEntry | null} */
    let wrote = null;
    try {
      wrote = (await saveMaterialKind(name, kind)).materialKinds[key] || null;
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
      return;
    }
    o.onSaved?.();
    const who = wafer ? `${name} wafers` : name;
    toast(kind ? `${who}: ${short(/** @type {MaterialKind} */ (kind))}. The checks use this in every project.` : `${who}: your answer is taken back.`,
      { action: { label: 'Undo', fn: () => { undo(kind, wrote); } } });
  };
  const now = current ? ` Your answer now: ${short(current)}.` : '';
  const sh = sheet(wafer ? `What kind of wafer is ${name}?` : `What is ${name}?`, [
    h('p', null, wafer
      ? `The checks know ${name} as a film, but not what kind of wafer it is. Your answer is only for wafers of ${name}, in every project and on every device that syncs.${now}`
      : `The checks do not know ${name}. Your answer counts in every project, and on every device that syncs.${now}`),
    h('div', { class: 'stack kind-choices', role: 'group', 'aria-label': wafer ? `What kind of wafer ${name} is` : `What ${name} is` }, choices.map((k) => {
      const b = button(label(k), { kind: k === current ? 'primary' : 'secondary', icon: k === current ? 'check' : undefined, onClick: () => pick(k) });
      b.setAttribute('aria-pressed', String(k === current));
      return b;
    })),
    current ? button('Take my answer back', { kind: 'ghost', icon: 'undo', onClick: () => pick('') }) : null,
  ]);
}

/**
 * One "What is PZT?" button per material a note asks about, or null when it asks about none.
 * @param {string[] | undefined} names
 * @param {(name: string, index: number) => void} onAsk
 * @param {string} [idBase] buttons get `${idBase}-${index}` ids, so focus can find them after a redraw
 * @returns {HTMLButtonElement[] | null}
 */
export function askButtons(names, onAsk, idBase) {
  if (!names || !names.length) return null;
  return names.map((name, i) => {
    const b = button(materialKnown(name) ? `What kind of wafer is ${name}?` : `What is ${name}?`, { icon: 'help', onClick: () => onAsk(name, i) });
    if (idBase) b.id = `${idBase}-${i}`;
    return b;
  });
}
