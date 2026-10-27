// @ts-check
/**
 * The LNF store's single wafers and mask plates, from screenshots of the
 * store the project owner sent on 2026-10-22 (boxes left out at their
 * request). Each item keeps the store's name and description exactly as
 * written: the store's naming does not always follow its own convention
 * ("Type P-10-80" whose description says 1-20 ohm-cm), so the spec holds
 * only what the store states. Doped wafers are silicon, and the oxide is
 * listed as thermal because the store's note says its oxide wafers come from
 * the Tempress furnaces (each says so in its notes); resistivity is never
 * read from a name. The mask plates' material, thickness, chrome and resist
 * come from the LNF wiki note on the Heidelberg µPG 501 (in
 * lnf-recipes-other.js), which describes the LNF-store photomask blanks.
 * Prices are as seen that day; stock is left out because it changes daily.
 *
 * These items are not stored or synced: they come with the app and change
 * only in a release. "Copy to your types" makes a saved entry the person can
 * edit. Ids are fixed, so a project's wafers can say which item they came
 * from.
 */

/** @typedef {import('../core/types.js').WaferSpec} WaferSpec */

/**
 * @typedef {Object} StoreItem
 * @property {string} id "lnf-store/<slug>"
 * @property {string} storeName the store's name, verbatim
 * @property {string} storeText the store's description, verbatim ("" when it shows none)
 * @property {number} price US dollars, for one item
 * @property {string} priceSeen the day the price was seen (YYYY-MM-DD)
 * @property {WaferSpec} spec
 */

const SEEN = '2026-10-22';
const OXIDE_NOTE = 'While Tempress S3T2 is down these are being made in Tempress S5T2, which is also the phosphorus anneal/drive in furnace.';
/** Where "thermal" comes from: the store's note above, on two of its four oxide wafers. */
const THERMAL = 'Listed as thermal oxide: the store’s note says these are made in the Tempress furnaces (S3T2, or S5T2 while S3T2 is down).';
const THERMAL_OTHER = 'Listed as thermal oxide: the store says only “oxide” here, and its note on its other oxide wafers says they are made in the Tempress furnaces.';
const PLATE = /** @type {const} */ ({
  kind: 'mask', material: 'Soda-lime glass', thicknessUm: 2286, coating: 'Low-reflectance chrome', resist: 'AZ1518, 400 nm',
  notes: 'Plate details from the LNF wiki note on the Heidelberg µPG 501: LNF-store photomask blanks are 4 or 5 in soda lime glass, 90 mil thick, low-reflectance chromium with 400 nm AZ1518 photoresist.',
});

/** @type {ReadonlyArray<StoreItem>} */
export const LNF_STORE = Object.freeze([
  {
    id: 'lnf-store/wafer-4in-glass-500um', storeName: 'Wafers 4", Type Glass 500µm thick (Solitaire)', storeText: '', price: 53.10, priceSeen: SEEN,
    spec: { material: 'Glass', size: '100mm', thicknessUm: 500 },
  },
  {
    id: 'lnf-store/wafer-4in-dsp-p-boron-prime', storeName: 'Wafers 4" Double Side Polished, P/Boron type "Prime" (solitaire)',
    storeText: 'Dia:100mm, Type/Dopant:P/Boron, Orientation:<100> Thickness:525um +/-25um, Resistivity:10-40 ohm-cm.', price: 46.90, priceSeen: SEEN,
    spec: {
      material: 'Si', size: '100mm', polish: 'dsp', doping: 'p', dopant: 'B', orientation: '<100>', thicknessUm: 525, thicknessTolUm: 25,
      resistivity: '10–40 Ω·cm', grade: 'Prime',
    },
  },
  {
    id: 'lnf-store/wafer-4in-n-1-10', storeName: 'Wafers 4", Type N-1-10, N-doped, 500-550 microns thick, (solitaire)', storeText: '',
    price: 35.12, priceSeen: SEEN, spec: { material: 'Si', size: '100mm', doping: 'n', thicknessUm: 525, thicknessTolUm: 25 },
  },
  {
    id: 'lnf-store/wafer-4in-p-10-20', storeName: 'Wafers 4", Type P-10-20, P-doped, 500-550 microns thick (solitaire)', storeText: '',
    price: 35.12, priceSeen: SEEN, spec: { material: 'Si', size: '100mm', doping: 'p', thicknessUm: 525, thicknessTolUm: 25 },
  },
  {
    id: 'lnf-store/wafer-4in-p-10-20-2um-oxide', storeName: 'Wafers 4", Type P-10-20 with 2 um of oxide (solitaire)',
    storeText: 'Type_P-10-20 (+2 µm oxide) package', price: 59.60, priceSeen: SEEN,
    spec: { material: 'Si', size: '100mm', doping: 'p', films: [{ material: 'SiO2 (thermal)', thicknessNm: 2000 }], notes: THERMAL_OTHER },
  },
  {
    id: 'lnf-store/wafer-4in-p-10-20-500nm-oxide', storeName: 'Wafers 4", Type P-10-20 with 500nm of oxide (solitaire)',
    storeText: OXIDE_NOTE, price: 50.90, priceSeen: SEEN,
    spec: { material: 'Si', size: '100mm', doping: 'p', films: [{ material: 'SiO2 (thermal)', thicknessNm: 500 }], notes: THERMAL },
  },
  {
    id: 'lnf-store/wafer-6in-p-10-80', storeName: 'Wafers 6", Type P-10-80 (solitaire)',
    storeText: 'Dia:150mm, Type/Dopant:P/Boron, Orientation:100 Resistivity 1-20 ohm-cm, Thickness 675 +/-25um', price: 59.30, priceSeen: SEEN,
    // Resistivity left empty: the name ("P-10-80") and the description (1-20 ohm-cm) disagree.
    spec: { material: 'Si', size: '150mm', doping: 'p', dopant: 'B', orientation: '<100>', thicknessUm: 675, thicknessTolUm: 25 },
  },
  {
    id: 'lnf-store/wafer-6in-p-10-80-2um-oxide', storeName: 'Wafers 6", Type P-10-80 with 2 um of oxide (solitaire)',
    storeText: OXIDE_NOTE, price: 85.30, priceSeen: SEEN,
    spec: { material: 'Si', size: '150mm', doping: 'p', films: [{ material: 'SiO2 (thermal)', thicknessNm: 2000 }], notes: THERMAL },
  },
  {
    id: 'lnf-store/wafer-6in-p-10-80-500nm-oxide', storeName: 'Wafers 6", Type P-10-80 with 500nm of oxide (solitaire)', storeText: '',
    price: 76.70, priceSeen: SEEN,
    spec: { material: 'Si', size: '150mm', doping: 'p', films: [{ material: 'SiO2 (thermal)', thicknessNm: 500 }], notes: THERMAL_OTHER },
  },
  {
    id: 'lnf-store/p5000-pecvd-a-si-carrier-6in', storeName: 'P5000 PECVD a-Si Carrier Wafer 6"', storeText: '', price: 222.80, priceSeen: SEEN,
    spec: { size: '150mm' },
  },
  {
    id: 'lnf-store/p5000-pecvd-standard-carrier-6in', storeName: 'P5000 PECVD Standard Carrier Wafer 6"', storeText: '', price: 189.00, priceSeen: SEEN,
    spec: { size: '150mm' },
  },
  {
    id: 'lnf-store/mask-plate-4in', storeName: 'Mask Plate 4" (Solitaire)', storeText: '', price: 41.56, priceSeen: SEEN,
    spec: { ...PLATE, size: 'plate4' },
  },
  {
    id: 'lnf-store/mask-plate-5in-master-low-bow', storeName: 'Mask Plate 5" MASTER Grade low bow (Solitaire)', storeText: '', price: 46.68,
    priceSeen: SEEN, spec: { ...PLATE, size: 'plate5', grade: 'MASTER' },
  },
]);

/**
 * @param {string | null | undefined} id
 * @returns {StoreItem | null}
 */
export function storeItem(id) {
  return (id && LNF_STORE.find((x) => x.id === id)) || null;
}
