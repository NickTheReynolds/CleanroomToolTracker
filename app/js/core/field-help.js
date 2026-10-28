// @ts-check
/**
 * What each template field means, for the "i" button beside its label: a
 * sentence or two on what the setting or result is and, where there is a
 * usual trend, what raising it tends to do; then how Lookup treats the
 * field, worked out from the field spec so it is right for any template.
 * The trends are general process knowledge, not tool-specific recipes: the
 * tool's own documentation and its engineer win. Pure, so the tests can
 * check that every seeded field has its text.
 */
import { DEFAULTS } from '../config.js';
import { DERIVED_INFO } from './derive.js';
import { fmtNum } from './format.js';

/** @typedef {import('./types.js').FieldSpec} FieldSpec */
/**
 * The parts of a template the texts depend on (a template being edited is enough).
 * @typedef {{name?: string, processType?: string, fields?: FieldSpec[], primaryOutput?: string | null,
 *   derived?: import('./types.js').DerivedSpec[]}} TemplateLike
 */

/**
 * One text for a field key, used when every condition it sets holds. The
 * first matching entry of a key wins, so specific ones come first. Entries
 * go by the template's other fields where they can: units and names are
 * free text, and a renamed template should keep its notes.
 * @typedef {Object} About
 * @property {string} text
 * @property {string} [unit] the field's unit (case and spaces ignored)
 * @property {string} [type] the field's type
 * @property {RegExp} [label] tested against the field's label
 * @property {string} [process] the template's process type
 * @property {RegExp} [name] tested against the template's name
 * @property {string} [has] the template also has a field with this key
 * @property {string[]} [lacks] the template has none of the fields with these keys
 */

/** Plasma cleaners and descum tools, by name or (if renamed) by their fields: RF power without the etchers' extras. */
const CLEAN = /clean|descum|ash|strip/i;
const CLEANER = { process: 'etch', has: 'rfPower', lacks: ['icpPower', 'chuckTemp', 'selectivity'] };
/** Critical point dryers. */
const CPD = /critical.?point|supercritical|\bcpd\b/i;

/** @type {Readonly<Record<string, About[]>>} */
const ABOUT = {
  // Plasma etch
  icpPower: [
    { has: 'platenPower', text: 'Power to the coil that makes the plasma. It mostly sets how many ions and radicals there are: more power usually etches faster, without raising ion energy much.' },
    { text: 'Power to the inductive coil that makes the plasma (the source power). It mostly sets plasma density: more power usually means more ions and radicals and a faster etch, without raising ion energy much. It also heats the wafer.' },
  ],
  rfPower: [
    { has: 'icpPower', text: 'Power to the electrode under the wafer (the bias). It sets how hard ions hit the wafer: more bias gives a more directional, physical etch, usually faster, but with lower selectivity to the mask and more surface damage.' },
    { name: CLEAN, text: 'Power that drives the plasma. More power usually removes resist and residue faster, but heats the sample more.' },
    { ...CLEANER, text: 'Power that drives the plasma. More power usually removes resist and residue faster, but heats the sample more.' },
    { process: 'deposition', text: 'Power that drives the plasma. More power usually raises the deposition rate and changes the film: more ion bombardment tends to make it denser, with more compressive stress.' },
    { process: 'etch', text: 'Power to the electrode under the wafer. In a reactive ion etcher it sets both plasma density and ion energy: more power usually etches faster and more directionally, with lower selectivity to the mask and more heating of the resist.' },
    { text: 'Power that drives the plasma. More power usually makes the process faster and harsher.' },
  ],
  platenPower: [{ text: 'Power to the platen under the wafer. It sets ion energy, which clears the passivation polymer from the trench floor while the walls stay coated. More platen power usually etches faster and more vertically, but wears the mask faster (lower selectivity).' }],
  pressure: [
    { process: 'etch', has: 'pulse', text: 'XeF2 vapour pressure in each etch pulse. Higher pressure usually etches more silicon per pulse. XeF2 etches silicon isotropically and is very selective to oxide, nitride, resist and Al, though it also etches Mo, W, Ti and Ge.' },
    { has: 'residual', text: 'Pressure pressing the stamp into the heated resist. More pressure usually fills the stamp’s cavities better and leaves a thinner residual layer; too much can damage the stamp.' },
    { has: 'slurry', text: 'Down force pressing the wafer onto the pad. The removal rate rises roughly in proportion to it (Preston’s law), but more pressure can also worsen dishing, erosion and scratches.' },
    { has: 'target', text: 'Working-gas (usually argon) pressure while sputtering. Lower pressure usually gives denser films with more compressive stress; higher pressure scatters the sputtered atoms more, often giving a lower rate and more tensile, porous films.' },
    { has: 'precursor', text: 'Reactor pressure, mostly set by the carrier and purge gas flows. It changes how fast precursors spread and purge out; as long as each pulse saturates the surface, the growth per cycle changes little.' },
    { process: 'deposition', has: 'rfPower', text: 'Chamber pressure during deposition. It changes the deposition rate, the uniformity across the wafer and the film stress; which way depends on the film.' },
    { process: 'deposition', name: /lpcvd/i, text: 'Tube pressure during deposition. Low pressure is what makes LPCVD films uniform across a full load of wafers; raising it usually speeds deposition but makes it less uniform.' },
    { process: 'deposition', text: 'Chamber pressure during deposition. It usually changes the deposition rate and how evenly the film coats; which way depends on the process.' },
    { name: CLEAN, text: 'Chamber pressure. Higher pressure usually gives a more chemical, isotropic clean; lower pressure a more directional one, mainly with the sample on the powered electrode (RIE mode). In a barrel or downstream asher the clean stays chemical.' },
    { ...CLEANER, text: 'Chamber pressure. Higher pressure usually gives a more chemical, isotropic clean; lower pressure a more directional one, mainly with the sample on the powered electrode (RIE mode). In a barrel or downstream asher the clean stays chemical.' },
    { text: 'Chamber pressure during the etch. Lower pressure usually gives a more directional (anisotropic) etch, because ions collide less on their way down; higher pressure gives more radicals and a more chemical, isotropic etch, often faster but with more undercut.' },
  ],
  chuckTemp: [{ text: 'Temperature of the electrode under the wafer. Colder usually gives a more directional etch (less sideways chemical etching, more sidewall passivation); warmer speeds up the chemical part of the etch and can burn or reflow resist.' }],
  heBackside: [{ text: 'Helium pressure between the wafer and the chuck, which carries heat away. More helium keeps the wafer closer to the chuck temperature; a leak (a bowed or poorly clamped wafer) lets the wafer run hotter.' }],
  etchStep: [{ text: 'Length of each SF6 etch step in the Bosch cycle. Longer steps etch more per cycle but leave bigger scallops on the walls and more undercut.' }],
  passStep: [{ text: 'Length of each C4F8 passivation step, which coats the walls with a Teflon-like polymer. Longer steps protect the walls better (more vertical or tapered walls) but slow the etch; too much can leave “grass” on the trench floor.' }],
  cycles: [
    { has: 'etchStep', text: 'Number of etch-and-passivation cycles. The depth grows with the count, but usually less per cycle as the trench deepens, and much less in narrow trenches.' },
    { process: 'deposition', text: 'Number of ALD cycles (precursor, purge, co-reactant, purge). Thickness ≈ cycles × growth per cycle, after a short start-up delay on some surfaces.' },
    { has: 'pulse', text: 'Number of XeF2 pulses (fill, etch, pump out). The etch grows with the number of pulses.' },
    { text: 'Number of repeated cycles.' },
  ],
  pulse: [
    { has: 'precursor', text: 'How long the precursor flows in each cycle. It must be long enough to cover the whole surface (saturation); longer than that adds no growth.' },
    { process: 'etch', text: 'How long each XeF2 pulse etches before the chamber is pumped out. Longer pulses remove more silicon per pulse, until the gas is used up.' },
    { text: 'Length of each pulse.' },
  ],
  beamVoltage: [{ text: 'Voltage that accelerates the ions (usually argon), setting their energy. Higher voltage usually mills faster but heats the resist more and damages the surface more deeply.' }],
  beamCurrent: [{ text: 'Ion beam current: how many ions arrive per second. The milling rate rises roughly in proportion, and so does heating of the wafer and resist.' }],
  angle: [{ text: 'Tilt between the beam and the wafer; usually 0° means the beam hits the wafer head-on, but check your tool. Tilting changes the milling rate and the sidewall angle, and reduces material redeposited on the sidewalls.' }],
  // Wet processing
  etchant: [{ text: 'The etch solution, for example BOE 6:1, KOH or a metal etchant. Write it the same way every time.' }],
  ratio: [{ text: 'Mixing ratio or concentration, for example 6:1 or 30% KOH. The etch rate depends strongly on it, and on how old the bath is.' }],
  chemistry: [{ text: 'The chemical or mixture, for example piranha, RCA SC-1 or an HF dip. Write it the same way every time.' }],
  sequence: [{ text: 'The solvents and their order, for example acetone, IPA, then DI water.' }],
  temp: [
    { has: 'etchant', text: 'Bath temperature. Wet etch rates rise quickly with temperature, so measure the bath rather than trusting the setpoint.' },
    { has: 'chemistry', text: 'Bath temperature. Most wet chemistry works much faster when hotter.' },
    { has: 'precursor', text: 'Substrate temperature. Inside the precursor’s “ALD window” the growth per cycle stays nearly constant; too cold gives condensation or incomplete reactions, too hot makes the precursor decompose (CVD-like growth) or lets reactive groups leave the surface (less growth).' },
    { has: 'bath', text: 'Bath temperature, usually fixed by the chemistry’s datasheet. It changes how smooth and stressed the deposit is and how fast it can be plated.' },
    { process: 'deposition', has: 'rfPower', text: 'Substrate (platen) temperature. Hotter usually gives a denser film with less hydrogen, which etches more slowly in HF; colder is needed over resist and other temperature-sensitive layers.' },
    { process: 'deposition', name: /lpcvd/i, text: 'Furnace temperature. The deposition rate rises steeply with it, and it sets film properties such as the structure of polysilicon (amorphous below about 580 °C).' },
    { process: 'deposition', text: 'Temperature during deposition. It usually changes the deposition rate and the film’s density and stress.' },
    { process: 'thermal', has: 'thickness', text: 'Furnace temperature. Oxide grows much faster at higher temperature.' },
    { process: 'thermal', has: 'ramp', text: 'Peak temperature. Higher temperatures act faster: dopant activation, silicide formation, densification. Pyrometer readings depend on the wafer’s backside, so compare runs on similar wafers.' },
    { process: 'thermal', text: 'Anneal temperature. Higher temperatures make the anneal act faster (diffusion, dopant activation, grain growth, stress relief) and can make layers react or mix.' },
    { has: 'purpose', text: 'Hotplate or oven temperature. For a soft bake it sets how much solvent leaves the resist; for a post-exposure bake it changes the dose needed and the linewidth. Follow the resist’s datasheet.' },
    { has: 'residual', text: 'Imprint temperature, above the resist’s glass transition so it flows into the stamp. Hotter lets it flow more easily and fill the stamp faster.' },
    { has: 'developer', text: 'Developer temperature. Warmer developer usually works faster, though for some resist and developer pairs the rate barely changes or even drops; keep it steady, as the develop time and linewidth shift with it.' },
    { has: 'method', text: 'Bond temperature. Hotter usually bonds faster and stronger. When the two wafers, or a layer between them, expand differently with heat, a hotter bond usually leaves more stress and bow after cooling.' },
    { has: 'adhesive', text: 'Bonding or curing temperature for the adhesive, solder or eutectic. Follow the material’s cure or reflow profile.' },
    { text: 'Process temperature.' },
  ],
  time: [
    { has: 'wire', text: 'How long ultrasonic energy is applied for each bond. Longer usually gives a wider, stronger bond, until the wire is over-deformed.' },
    { has: 'etchant', text: 'Time in the etchant. The thickness removed grows with time; the etch rate is what carries over between runs.' },
    { has: 'developer', text: 'Time in the developer. Longer development clears more and widens openings in a positive resist; too short leaves residue (scum).' },
    { has: 'residual', text: 'How long the stamp is held at temperature and pressure. Longer holds let the resist fill the stamp more completely.' },
    { has: 'purpose', text: 'Bake time. Longer bakes drive out more solvent (soft bake) or let the exposure chemistry go further (post-exposure bake).' },
    { has: 'slurry', text: 'Polishing time. The thickness removed grows with time; the removal rate does not.' },
    { has: 'etchStep', text: 'Total etch time, all cycles included. The depth grows with time, but usually more slowly as trenches deepen (aspect-ratio-dependent etching), so a long etch averages a lower rate than a short one.' },
    { process: 'thermal', has: 'thickness', text: 'Time at temperature. Oxide grows about linearly with time at first, then more slowly (roughly with the square root of time) as it thickens.' },
    { process: 'etch', text: 'How long the etch runs. The thickness removed grows with time; the etch rate does not.' },
    { process: 'deposition', text: 'How long the deposition runs. Thickness grows with time; the deposition rate does not.' },
    { process: 'thermal', text: 'Time at the process temperature. Longer anneals let diffusion and reactions go further.' },
    { has: 'chemistry', text: 'Time in the bath.' },
    { has: 'sequence', text: 'Time in the solvents (in total or per bath: say which in the notes).' },
    { has: 'method', text: 'Time held at the bond temperature and force (and voltage, for anodic bonding). Longer holds usually give a more complete bond.' },
    { has: 'adhesive', text: 'Time at the bonding or curing temperature. Follow the adhesive’s cure schedule.' },
    { name: CPD, text: 'Length of the drying program (or of its purge step: say which in the notes). The purge flushes the solvent out with liquid CO2; too short a purge leaves solvent behind, which can let released structures stick.' },
    { text: 'How long the step runs.' },
  ],
  // Results
  etchRate: [
    { has: 'slurry', text: 'Thickness removed per minute of polishing: removed ÷ time. If the film cleared before the end, this is only a lower limit.' },
    { has: 'beamVoltage', text: 'Thickness removed per minute: removed ÷ time. In ion milling it depends mostly on the material, the beam voltage and current, and the angle; unlike a plasma etch, it hardly changes with how much of the wafer is open. If the film cleared before the run ended, this is only a lower limit.' },
    { text: 'Thickness removed per minute: removed ÷ time. It changes with the tool’s condition and with how much of the film is exposed (loading). If the film cleared before the run ended, this is only a lower limit.' },
  ],
  etchRateUm: [{ text: 'Depth etched per minute: depth ÷ time. It usually falls as trenches get deeper or narrower (aspect-ratio-dependent etching) and as more of the wafer is open to the etch (loading).' }],
  removed: [{ text: 'Thickness removed: the mean before minus the mean after, measured at the same sites.' }],
  uniformity: [
    { process: 'etch', text: 'How even the result is across the wafer, as a percentage of the mean; smaller is more even. When worked out from the post measurement, it is the spread of the film left after the etch, which includes the film’s starting spread, so it is not the etch uniformity that recipe sheets quote. Use the same method every time.' },
    { text: 'How even the result is across the wafer, as a percentage of the mean; smaller is more even. Methods differ ((max − min) ÷ (2 × mean), or standard deviation ÷ mean), so use the same one every time.' },
  ],
  selectivity: [{ text: 'How much faster the film etches than the mask: film removed ÷ mask removed in the same run. Higher means the mask lasts longer.' }],
  depth: [
    { has: 'pulse', text: 'How far the silicon was etched: the depth of an open area or the undercut beneath a mask edge (say which in the notes). XeF2 etches silicon equally in every direction, so the two are similar.' },
    { text: 'Depth of the etched feature below the original surface, from a profilometer (wide openings only: a stylus cannot reach the bottom of narrow, deep trenches) or a cross-section. Narrow features usually etch shallower than wide ones in the same run.' },
  ],
  sidewall: [{ text: 'Angle between the sidewall and the wafer surface: 90° is vertical, below 90° a sloped (tapered) wall, above 90° an overhanging (re-entrant) one.' }],
  thickness: [
    { has: 'speed', text: 'Resist thickness after the soft bake.' },
    { process: 'metrology', text: 'The measured film thickness.' },
    { process: 'thermal', text: 'Oxide thickness grown.' },
    { text: 'Film thickness deposited, measured after the run.' },
  ],
  depRate: [{ text: 'Thickness deposited per minute: thickness ÷ time.' }],
  refractiveIndex: [{ text: 'Refractive index, usually measured at 633 nm by ellipsometry. It is a quick check of composition and density: thermal SiO2 is about 1.46 and stoichiometric Si3N4 about 2.0; silicon-rich films read higher.' }],
  stress: [{ text: 'Film stress, usually worked out from the change in wafer bow. Most tools report tensile stress as positive and compressive as negative; check yours.' }],
  sheetResistance: [{ text: 'Resistance of a square of the film, from a four-point probe. It equals resistivity ÷ thickness, so thicker or more conductive films read lower.' }],
  // Deposition
  target: [{ text: 'The sputter target material, for example Ti, Al or ITO. Write it the same way every time.' }],
  source: [
    { has: 'target', text: 'Power supply type. DC suits conductive (metal) targets; RF can sputter insulating targets; pulsed DC is used for reactive sputtering of oxides and nitrides, to prevent arcing.' },
    { text: 'The material being evaporated, for example Ti, Au or Al. Write it the same way every time.' },
  ],
  power: [
    { has: 'target', text: 'Power to the target. The deposition rate rises roughly in proportion; more power also heats the target and the sample.' },
    { has: 'wire', text: 'Ultrasonic power, in the bonder’s own units. Too little gives bonds that lift off; too much over-flattens the wire or damages the pad.' },
    { text: 'Power setting.' },
  ],
  substrateTemp: [{ text: 'Substrate temperature during deposition. Hotter substrates usually give denser films with larger grains and different stress.' }],
  rateSetpoint: [{ text: 'Deposition rate the crystal monitor holds by adjusting the source power. Slower rates give finer control of thin layers. Faster rates heat the sample faster, but long slow runs heat it too; for thick liftoff layers on resist, pausing to cool helps.' }],
  qcmThickness: [{ text: 'Thickness reported by the quartz crystal monitor. It relies on the density and tooling factor set in the controller, so it can differ from the thickness measured on the wafer; recording both lets you check the tooling factor.' }],
  basePressure: [{ text: 'Chamber pressure before the deposition starts. Lower base pressure leaves less water and oxygen to end up in the film, which matters most for reactive metals such as Ti and Al.' }],
  precursor: [{ text: 'The precursor that brings the metal or silicon, for example TMA for Al2O3 or TDMAH for HfO2. Write it the same way every time.' }],
  coreactant: [{ text: 'The second reactant that completes each cycle: water, ozone or a plasma. It affects film quality and impurities, and which temperatures work.' }],
  purge: [{ text: 'Inert-gas purge after each pulse that clears leftover precursor. Too short lets the two reactants meet in the gas (CVD-like growth): the growth per cycle rises and uniformity suffers.' }],
  gpc: [{ text: 'Growth per cycle in ångströms: thickness in nm × 10 ÷ cycles. Inside the ALD window it stays nearly constant for a given process.' }],
  bath: [{ text: 'The plating bath and metal, for example acid copper or gold sulfite. Write it the same way every time.' }],
  current: [
    { has: 'dose', text: 'Beam current. Higher current writes faster but with a larger beam spot, so the finest features need a low current.' },
    { has: 'bath', text: 'Current per area of plated surface. The plating rate is proportional to it (Faraday’s law); too high gives rough, burnt or stressed deposits, especially at edges.' },
    { text: 'Current setting.' },
  ],
  dimer: [{ text: 'The parylene type. C is the usual barrier coating, N penetrates narrow gaps better, D tolerates somewhat more heat than C, and HT tolerates the most.' }],
  dimerMass: [{ text: 'Mass of dimer loaded. The coating thickness grows roughly in proportion to it, for a given chamber load.' }],
  // Thermal
  ambient: [
    { process: 'thermal', has: 'thickness', text: 'Dry O2 grows a slow, dense oxide for thin, high-quality layers; wet (steam) oxidation grows several times faster and is used for thick oxides.' },
    { text: 'Gas around the wafer. Ar is inert and N2 nearly so, though hot N2 turns Ti and similar metals into nitrides. Forming gas (H2 in N2) passivates defects at the silicon–oxide interface and keeps metals from oxidising; O2 oxidises exposed surfaces. Vacuum avoids most gas reactions, though traces of oxygen and water can still oxidise Ti or Al.' },
  ],
  o2Flow: [{ text: 'Oxygen flow into the furnace tube. Usually fixed; recorded for reference.' }],
  ramp: [{ text: 'How fast the lamps heat the wafer. Faster ramps cut the time spent at in-between temperatures (less diffusion) but can overshoot or stress the wafer.' }],
  // Lithography
  resist: [{ text: 'The resist, for example S1813, SPR 220 or PMMA. Write it the same way every time.' }],
  speed: [{ text: 'Final spin speed. Resist thickness falls with speed, roughly as one over its square root: doubling the speed thins the film by about 30%.' }],
  spinTime: [{ text: 'Time at the final spin speed. Most of the thinning happens in the first seconds; longer spins thin and dry the film a little more.' }],
  accel: [{ text: 'How fast the spinner ramps up to speed. It affects thickness uniformity and how the resist covers steps on the wafer.' }],
  bakeTemp: [{ text: 'Hotplate temperature for the soft bake after coating. Hotter or longer bakes leave less solvent in the resist, which changes the dose it needs and how fast it develops.' }],
  bakeTime: [{ text: 'Soft bake time. Longer bakes drive out more solvent, like a hotter bake.' }],
  purpose: [{ text: 'Which bake this is. Soft bake: dries the resist after coating. Post-exposure bake: after exposure, needed by chemically amplified and image-reversal resists. Hard bake: toughens the resist before etching or plating. Dehydration: dries the wafer before priming.' }],
  dose: [
    { has: 'stepSize', text: 'Charge per area delivered by the beam. Too little leaves resist in the written areas of a positive resist (PMMA, ZEP) and thin, weak lines in a negative one (HSQ); too much widens features and merges close ones. Scattered electrons add dose around every feature (the proximity effect), so dense patterns usually need less dose than isolated ones. Find the best dose with a dose test.' },
    { unit: 'µC/cm²', text: 'Charge per area delivered by the beam. Too little leaves resist in the written areas of a positive resist (PMMA, ZEP) and thin, weak lines in a negative one (HSQ); too much widens features and merges close ones. Scattered electrons add dose around every feature (the proximity effect), so dense patterns usually need less dose than isolated ones. Find the best dose with a dose test.' },
    { has: 'mode', text: 'Exposure energy per area: lamp intensity × exposure time. More dose widens what the light reaches: the openings in a positive resist, the remaining lines in a negative one. Too little leaves resist in the openings of a positive resist, and thin or lifting lines in a negative one.' },
    { name: /laser/i, text: 'Laser dose per area, or the writer’s power or intensity setting. More dose widens what the beam reaches: openings in a positive resist, lines in a negative one. Too little leaves resist in the openings of a positive resist, and thin or missing lines in a negative one.' },
    { text: 'Exposure energy per area (or the exposure time, if your tool is set that way; say which in the notes). More dose widens what the light reaches: openings in a positive resist, lines in a negative one.' },
  ],
  exposeTime: [{ text: 'The writer’s exposure time setting, which sets how much light each spot gets. Longer exposure widens what the beam reaches, like more dose. LNF posts the standard value at the tool and updates it after major maintenance, so check it before you write.' }],
  mode: [{ text: 'How close the mask sits to the resist. Vacuum and hard contact give the finest features but wear the mask and can pick up resist; soft contact presses more lightly, with slightly coarser features; proximity leaves a small gap, gentle on the mask but blurring small features.' }],
  focus: [
    { unit: 'µm', text: 'Offset of the focal plane from the tool’s best focus. Away from best focus the linewidth drifts and the sidewalls lose their angle; a focus–exposure matrix finds the best value.' },
    { text: 'The writer’s focus offset, in its own units. Match it to the resist thickness; a wrong value blurs edges and changes linewidths.' },
  ],
  resistThickness: [{ text: 'Resist thickness for this exposure. Thicker resist needs more dose and limits the smallest features you can open.' }],
  devTime: [{ text: 'Time in the developer after exposure. Longer development clears more and widens openings in a positive resist; too short leaves residue (scum).' }],
  cd: [{ text: 'Critical dimension: the measured width of your reference feature (say in the notes whether it is a line or a space).' }],
  stepSize: [{ text: 'Beam step size (pixel spacing). It should be a small fraction of the smallest feature; smaller steps give smoother edges. The write time is set mostly by dose and current, but very small steps can slow it once each shot reaches the tool’s shortest dwell time.' }],
  linewidth: [{ text: 'Measured width of the written line after developing.' }],
  residual: [{ text: 'Resist left under the stamp’s raised areas, removed afterwards by a short descum etch. Thinner is better for pattern transfer.' }],
  developer: [{ text: 'The developer, for example MF-319, AZ 726 MIF or MIBK:IPA 1:3. Write it the same way every time.' }],
  // Other processes
  slurry: [{ text: 'The polishing slurry. The removal rate and the selectivity between materials depend strongly on it. Write it the same way every time.' }],
  platen: [{ text: 'Rotation speed of the polishing pad. The removal rate rises roughly with the speed of the pad past the wafer (Preston’s law).' }],
  carrier: [{ text: 'Rotation speed of the wafer carrier. Running it close to the platen speed evens out the pad speed across the wafer, which helps uniformity.' }],
  method: [{ text: 'Anodic: sodium-containing glass (such as Pyrex or Borofloat, not fused silica) to silicon, with heat and voltage. Fusion: very clean, flat surfaces bonded directly, then annealed. Eutectic: through a metal layer that melts at a low eutectic point (for example Au–Si). Thermocompression: metal to metal with heat and force. Adhesive: through a polymer such as BCB.' }],
  force: [
    { has: 'wire', text: 'Force pressing the wire onto the pad. Too little gives weak bonds; too much over-flattens the wire or cracks the pad.' },
    { has: 'method', text: 'Force pressing the wafers together. More force improves contact for metal and adhesive bonds; too much can crack the wafers.' },
    { text: 'Force applied.' },
  ],
  voltage: [{ text: 'Voltage across the stack for anodic bonding. Higher voltage bonds faster; other bond types do not use it.' }],
  recipe: [{ name: CPD, text: 'The dryer’s program name or number.' }, { text: 'The program or recipe name on the tool.' }],
  blade: [{ text: 'The dicing blade (its type and thickness), matched to the material. It sets the kerf width and the edge quality.' }],
  spindle: [{ text: 'Blade rotation speed. Each blade has a recommended range; outside it, chipping and blade wear increase.' }],
  feed: [{ text: 'How fast the wafer moves under the blade. Slower feeds give cleaner edges with less chipping; faster feeds save time.' }],
  wire: [{ text: 'Bond wire material. Gold is usually ball-bonded with heat; aluminium is wedge-bonded at room temperature.' }],
  pull: [{ text: 'Force at which the bond failed in a pull test. Note how it failed: a bond that lifts off is weaker than a wire that breaks. The force also depends on where the hook pulls and on the loop height, so pull the same way each time.' }],
  adhesive: [{ text: 'How the die is attached, for example silver epoxy, solder or a eutectic.' }],
  // Metrology
  model: [
    { label: /stack/i, text: 'The film stack entered for the measurement, for example resist on Si or SiO2 on Si.' },
    { text: 'The optical model used for the fit (layers and materials). The thickness and index only mean something when the model is right.' },
  ],
  gof: [{ text: 'How well the model fits the measured data. For a goodness-of-fit score, closer to 1 is better; some tools report an error (MSE) instead, where lower is better.' }],
  scanLength: [{ text: 'Length of the stylus scan. It should cross the step with enough flat surface on each side to level the trace.' }],
  stylusForce: [{ text: 'Force on the stylus. Too much can scratch soft films such as resist; too little lets the stylus skip on rough surfaces.' }],
  stepHeight: [{ text: 'Height of the measured step, for example an etch depth or a film edge.' }],
  objective: [{ text: 'Objective and measurement mode. On an interferometer, phase-shifting (PSI) suits smooth surfaces and small steps, and white-light vertical scanning (VSI) suits taller steps and rough surfaces; a laser confocal microscope has no such modes. A higher-magnification objective usually resolves finer detail and steeper slopes but sees a smaller area.' }],
  roughness: [{ text: 'Average roughness Ra: the mean distance of the surface from its average height. It depends on the area measured and on the lateral resolution (the objective, or the AFM tip), so compare measurements made the same way.' }],
  probe: [{ text: 'Which probe head or program was used.' }],
  film: [{ text: 'The film whose stress was measured.' }],
  scanSize: [{ text: 'Side length of the AFM scan. Roughness depends on scan size, so compare scans of the same size.' }],
  settings: [{ text: 'Any other settings worth keeping with the run.' }],
};

/** What each gas does, by field key (gasKey of its name). */
/** @type {Readonly<Record<string, About[]>>} */
const GAS = {
  sf6: [{ text: 'SF6, a fluorine source that etches silicon fast and isotropically on its own. More SF6 usually raises the silicon etch rate.' }],
  c4f8: [
    { has: 'passStep', text: 'C4F8, a fluorocarbon that forms a Teflon-like polymer. In the Bosch process it is the passivation gas that coats the walls; in deep oxide and glass etching it is the main etch gas.' },
    { text: 'C4F8, a fluorocarbon that forms a lot of polymer. In oxide and nitride etches it is often the main etch gas, and more of it usually raises selectivity to silicon and resist; in silicon etches it is added to coat the sidewalls. Too much can stop the etch.' },
  ],
  cf4: [
    { process: 'deposition', text: 'CF4, used with O2 to clean the chamber between depositions.' },
    { text: 'CF4, a fluorocarbon for etching oxide, nitride and silicon. It forms little polymer on its own: a little O2 usually speeds it up, though too much slows it again; adding H2 or CHF3 adds polymer and selectivity to silicon.' },
  ],
  chf3: [{ text: 'CHF3, a fluorocarbon for oxide and nitride etching. It forms more polymer than CF4, which raises selectivity to silicon and resist but can slow the etch.' }],
  c2f6: [
    { process: 'deposition', text: 'C2F6, used with O2 to clean the chamber between depositions.' },
    { text: 'C2F6, a fluorocarbon for oxide etching that forms more polymer than CF4 and less than C4F8.' },
  ],
  o2: [
    { has: 'beamVoltage', text: 'O2, a reactive gas the ion source can use with or instead of Ar (reactive ion-beam etching).' },
    { has: 'target', text: 'O2, the reactive gas for sputtering oxides. More O2 makes the film more fully oxidised but slows deposition as the target surface oxidises.' },
    { process: 'deposition', has: 'rfPower', text: 'O2, used with CF4 or C2F6 to clean the chamber between depositions, and an oxygen source for some oxide films; silane-based PECVD oxide usually takes its oxygen from N2O instead.' },
    { process: 'deposition', text: 'O2, an oxygen source for oxide films.' },
    { process: 'thermal', text: 'O2, the oxidising gas.' },
    { text: 'O2. It burns off resist and polymer; added to fluorine etches it removes polymer and frees more fluorine, usually speeding the etch but eating the resist mask faster. In SF6 silicon etches it can also form an oxyfluoride film on the walls that reduces undercut.' },
  ],
  ar: [
    { has: 'target', text: 'Ar, the sputtering gas. Its flow, with the pumping speed, sets the working pressure.' },
    { has: 'beamVoltage', text: 'Ar, the gas the ion source turns into the ion beam.' },
    { process: 'deposition', text: 'Ar, an inert carrier or diluent gas.' },
    { text: 'Ar, an inert gas that steadies the plasma and adds physical sputtering. More Ar makes the etch more physical and less selective.' },
  ],
  cl2: [{ text: 'Cl2, for etching aluminium (usually with BCl3), chromium (with O2, which makes volatile CrO2Cl2), silicon and III–V compounds. More Cl2 usually raises the etch rate.' }],
  bcl3: [{ text: 'BCl3, used with Cl2 to etch aluminium and III–V materials. It scavenges oxygen and water and breaks through native oxides such as Al2O3.' }],
  hbr: [{ text: 'HBr, for silicon and polysilicon etching with high selectivity to oxide and smooth, vertical walls.' }],
  he: [{ text: 'He, a light inert diluent that steadies the plasma and helps spread heat.' }],
  n2: [
    { has: 'beamVoltage', text: 'N2, a gas the ion source can use with or instead of Ar, or to vent the chamber.' },
    { has: 'target', text: 'N2, the reactive gas for sputtering nitrides such as TiN. More N2 makes the film more nitrogen-rich but slows deposition as the target surface turns to nitride.' },
    { process: 'deposition', text: 'N2, a carrier, diluent or purge gas, and a nitrogen source in some nitride films.' },
    { process: 'thermal', text: 'N2, an inert gas for purging the tube and for anneals.' },
    { ...CLEANER, text: 'N2. On its own it gives a mild plasma that cleans and activates surfaces without oxidising them; a little added to O2 can speed up resist ashing.' },
    { text: 'N2, a mostly inert diluent; it can add nitrogen to sidewall passivation.' },
  ],
  h2: [
    { process: 'etch', text: 'H2. In fluorocarbon etches it ties up fluorine, adding polymer and raising selectivity to silicon; with CH4 it etches III–V materials.' },
    { process: 'thermal', has: 'thickness', text: 'H2, burned with O2 in the torch to make steam for wet oxidation.' },
    { process: 'thermal', text: 'H2, a reducing gas. Mixed into N2 as forming gas it passivates the silicon–oxide interface and keeps metals from oxidising; it is also used with carbon gases to grow graphene or nanotubes.' },
    { text: 'H2, a diluent that changes how much hydrogen the film holds and its structure.' },
  ],
  h: [{ text: 'Hydrogen (listed as “H” on the tool’s wiki page).' }],
  ch4: [
    { process: 'thermal', text: 'CH4, a carbon source for growing graphene or carbon nanotubes, usually with H2.' },
    { text: 'CH4. With H2 it etches III–V materials such as InP and GaAs, and it adds polymer.' },
  ],
  nf3: [
    { process: 'deposition', text: 'NF3, used to clean the chamber between depositions.' },
    { text: 'NF3, a strong fluorine source for fast silicon and nitride etching and for chamber cleaning.' },
  ],
  xef2: [{ text: 'XeF2 vapour, which etches silicon isotropically without a plasma.' }],
  sih4: [{ text: 'SiH4 (silane), a silicon source. More silane usually raises the deposition rate and makes oxide and nitride films silicon-rich, with a higher refractive index.' }],
  sih2cl2: [{ text: 'SiH2Cl2 (dichlorosilane, DCS), the silicon source for LPCVD nitride and, with N2O, for high-temperature oxide (HTO) and oxynitride. More DCS relative to NH3 gives silicon-rich, low-stress nitride.' }],
  nh3: [{ text: 'NH3, a nitrogen source for silicon nitride and oxynitride. In nitride, more NH3 relative to the silicon source gives nitrogen-richer films with a lower refractive index; in oxynitride, more NH3 relative to N2O adds nitrogen and raises the index toward that of nitride (about 2.0).' }],
  n2o: [{ text: 'N2O, an oxygen source for oxide and oxynitride films. More N2O relative to the silicon source brings the film toward stoichiometric SiO2 (index about 1.46).' }],
  tetraethylsilicate: [{ text: 'TEOS (tetraethyl orthosilicate), a liquid silicon source for oxide films with good step coverage.' }],
  c2h2: [{ text: 'C2H2 (acetylene), a carbon-rich gas that adds polymer, or carbon in growth processes.' }],
  c2h4: [{ text: 'C2H4 (ethylene), a carbon source, for example for carbon nanotube or graphene growth.' }],
  gas10o2inhe: [{ text: '10% O2 in He, a dilute oxygen mix. Small amounts added to HBr or Cl2 silicon etches raise the selectivity to oxide.' }],
  gas5bcl3he: [{ text: '5% BCl3 in He, a boron source, for example for p-type doped polysilicon.' }],
  gas5ph3sih4: [{ text: '5% PH3 in SiH4, phosphine in silane, for depositing phosphorus-doped (n-type) silicon. More of it relative to pure SiH4 adds phosphorus but usually slows deposition markedly.' }],
  cf44o2: [{ text: 'CF4 premixed with 4% O2, a classic mixture for etching silicon and nitride.' }],
};

/** @param {unknown} s @returns {string} unit or name compared without case or spaces */
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/**
 * @param {About} a
 * @param {FieldSpec} f
 * @param {TemplateLike | null | undefined} t
 * @returns {boolean}
 */
function fits(a, f, t) {
  if (a.unit !== undefined && norm(a.unit) !== norm(f.unit)) return false;
  if (a.type && a.type !== f.type) return false;
  if (a.label && !a.label.test(f.label || '')) return false;
  if (a.process && (!t || t.processType !== a.process)) return false;
  if (a.name && !(t && a.name.test(t.name || ''))) return false;
  if (a.has && !(t && (t.fields || []).some((x) => x.key === a.has))) return false;
  if (a.lacks && !(t && !(t.fields || []).some((x) => a.lacks?.includes(x.key)))) return false;
  return true;
}

/**
 * @param {readonly About[] | undefined} list
 * @param {FieldSpec} f
 * @param {TemplateLike | null | undefined} t
 * @returns {string}
 */
const first = (list, f, t) => (list || []).find((a) => fits(a, f, t))?.text || '';

/**
 * What a template field is and, where there is a usual trend, what raising
 * it does. Empty for a field the app knows nothing about.
 * @param {FieldSpec} f
 * @param {TemplateLike | null} [t]
 * @returns {string}
 */
export function aboutField(f, t) {
  const known = first(ABOUT[f.key], f, t);
  if (known) return known;
  const unit = norm(f.unit);
  if (!f.chemistry && unit !== 'sccm' && unit !== 'slm') return '';
  const gas = first(GAS[f.key], f, t) || `${f.label}: a gas line.`;
  const flow = unit === 'slm' ? 'Flow in slm (standard litres per minute; 1 slm = 1000 sccm).'
    : !unit || unit === 'sccm' ? 'Flow in sccm (standard cubic centimetres per minute).' : '';
  return flow ? `${gas} ${flow}` : gas;
}

/**
 * The distance weight Lookup gives a field: its weight (negative counts as
 * 0), else 1, or 0 for a duration (docs/ALGORITHM.md, Terms).
 * @param {FieldSpec} f
 * @returns {number}
 */
function weightOf(f) {
  if (typeof f.weight === 'number' && Number.isFinite(f.weight)) return Math.max(0, f.weight);
  return f.type === 'duration' ? 0 : 1;
}

/**
 * How Lookup treats a field, worked out from its spec and its template.
 * @param {FieldSpec} f
 * @param {TemplateLike | null} [t]
 * @returns {string}
 */
export function lookupUse(f, t) {
  if (f.role === 'context') return 'Recorded with the run; Lookup never matches on it.';
  const numeric = f.type === 'number' || f.type === 'duration';
  if (f.role === 'output') {
    // Lookup estimates only number results, and only for templates with inputs to match on.
    const hasInputs = (t?.fields || []).some((x) => x.role === 'input');
    const primary = t?.primaryOutput === f.key;
    const d = (t?.derived || []).find((x) => x.output === f.key);
    const info = d ? /** @type {Record<string, {formula: string}>} */ (DERIVED_INFO)[d.fn] : null;
    const lead = !numeric ? (primary ? 'The main result.' : 'A result, kept with the run.')
      : primary ? `The main result: lists and charts show it${hasInputs ? ', and Lookup estimates it first' : ''}.`
        : hasInputs ? 'A result. Lookup can estimate it from similar past runs.' : 'A result, kept with the run.';
    return [lead, info ? `Calculated from your measurements as ${info.formula}; a value typed here replaces it.` : '']
      .filter(Boolean).join(' ');
  }
  const w = weightOf(f);
  if (f.matchExact && !numeric) return 'When you set it in Look up, Lookup only compares runs with the same value (case and extra spaces ignored).';
  const gases = 'With Strict chemistry on, Lookup only compares runs where the same gases flow; an empty gas counts as off. In Look up, leave a gas you will not use empty rather than 0: a 0 counts as a difference from past runs that left it empty.';
  if (w === 0) {
    if (f.chemistry) return `Lookup leaves its flow out of the distance (weight 0). ${gases}`;
    return f.type === 'duration'
      ? 'Lookup leaves it out (weight 0): a time changes how much a run does, not its rate. Give it a weight in the template to match on it.'
      : 'Lookup ignores it (its weight in the template is 0).';
  }
  const unit = f.type === 'duration' ? 's' : f.unit || '';
  const adds = fmtNum(w);
  const parts = [];
  if (!numeric) {
    parts.push(`Lookup prefers past runs with the same value: a different one adds ${fmtNum(w * DEFAULTS.CATEGORICAL_PENALTY)} to the distance.`);
  } else if (typeof f.spreadHint === 'number' && f.spreadHint > 0) {
    parts.push(`Lookup prefers past runs close to this value: a difference of ${fmtNum(f.spreadHint)}${unit ? ` ${unit}` : ''} adds ${adds} to the distance.`);
  } else {
    parts.push(`Lookup prefers past runs close to this value. How big a difference counts comes from the spread of your similar past runs once at least 4 have a value; until then, a 10% difference adds ${adds} to the distance.`);
  }
  if (f.chemistry) parts.push(gases);
  return parts.join(' ');
}

/**
 * The note behind a template field's "i" button, one paragraph per entry.
 * @param {FieldSpec} f
 * @param {TemplateLike | null} [t]
 * @returns {string[]}
 */
export function fieldHelp(f, t) {
  return [aboutField(f, t), lookupUse(f, t)].filter(Boolean);
}

/** Field keys and gas keys with their own text (for the tests). */
export const KNOWN_KEYS = Object.freeze({ fields: Object.keys(ABOUT), gases: Object.keys(GAS) });
