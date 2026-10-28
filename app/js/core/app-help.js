// @ts-check
/**
 * The notes behind the "i" buttons on the app's own fields: the sample,
 * notes and times of a run, Lookup's match rules and tuning, measurements,
 * tool events, tool and template settings, sync, backup and History. A
 * template's fields have theirs in field-help.js. Pure data, so the tests
 * can check that every tunable constant has its note.
 */

/**
 * Help for the Lookup tuning constants (Settings), by TUNABLE key: what each
 * does, then what raising or lowering it changes.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const TUNING_HELP = Object.freeze({
  HALF_LIFE_DAYS: Object.freeze([
    'How fast older runs fade from the similar-runs average. A run this many days old counts half as much as one from today, and one twice as old a quarter as much.',
    'Shorter: the average follows recent tool behaviour (drift, a fresh clean) but rests on fewer runs. Longer: steadier, but slower to notice a change. It does not change which runs match or their order. A tool can set its own half-life in its settings.',
  ]),
  EVENT_PENALTY: Object.freeze([
    'How much a run counts in the similar-runs average once a major tool event has happened since it (any event marked major; a PM, chamber clean or target change is major unless you change it). The run’s weight is multiplied by this number.',
    '1 leaves the weight unchanged (runs are still marked, and confidence still notes the event); 0.5 halves it; 0 leaves those runs out of the average, unless every run in it is from before the event. They still show in the list, marked “Before last …”.',
  ]),
  TOP_K: Object.freeze([
    'How many of the closest runs make up the similar-runs average and the suggested-time range, and how many results show before Show more.',
    'More runs: a steadier average that reaches further from your planned settings. Fewer: only the closest runs, but noisier.',
  ]),
});

/**
 * Help for the app's own fields, by a stable name.
 * @type {Readonly<Record<string, string>>}
 */
export const HELP = Object.freeze({
  // A run
  recipe: 'The recipe name on the tool. Choosing one of the tool’s LNF recipes fills in its parameters, and you can still change any value. The name is kept with the run, and History search finds it.',
  recipeName: 'The recipe name on the tool. It is kept with the run, and History search finds it.',
  material: 'The film this run etches, deposits or measures: the layer whose thickness you track. Rates are worked out from this material’s measurements, and Lookup’s Same material rule only compares runs on the same material.',
  substrate: 'What the film sits on, for example Si, SiO2 on Si or glass. Kept for reference; Lookup does not match on it.',
  maskMaterial: 'The masking layer, for example photoresist or a hard mask. Selectivity is worked out from how much this layer and the film thinned in the same run, so measure the mask before and after too.',
  targetThickness: 'The thickness you aim to etch or deposit, in nm. Kept with the run and in exports, so you can compare what you aimed for with what you got.',
  notes: 'Anything worth remembering: what looked odd, what you changed, alarms on the tool. History search looks in notes.',
  tags: 'Short labels separated by commas, for example “dummy, test, seasoning”. History search finds runs by their tags.',
  started: 'When the run started. It orders History, and it sets each run’s age in Lookup, where older runs count less (Half-life in Settings).',
  ended: 'When the run ended. Marking the run complete fills it in.',
  // Lookup
  lookupTarget: 'How much you want to etch or deposit, in nm. When the result is a rate in nm/min, Lookup turns it into a suggested time (target ÷ rate), with a range from the closest runs.',
  strictChemistry: 'On: only runs where the same gases were flowing (above 0 sccm) count, gas by gas; an empty gas counts as off. Off: runs with other gas mixes count too, ranked by how far their flows are from the gases you set; a gas left empty is not compared.',
  sameMaterial: 'On: only runs on the same material count (case and extra spaces ignored). Off: runs on any material count, which helps when you have few runs but mixes materials that etch or deposit at different rates.',
  includeSiblings: 'On: runs logged with another template of the same process type count too, on this tool or on other tools of the same category. Useful for a tool with little history, but other tools and templates may behave differently.',
  lookupOutput: 'Which result Lookup summarises. It starts with the template’s main result.',
  // Measurements
  measurePhase: 'Pre is measured before the run, post after. Removed and the etch rate need both; a deposition without a pre measurement counts from zero.',
  measureKind: 'What you measured. Thickness feeds the worked-out results (rate, removed, uniformity) unless the template says otherwise; other kinds are kept with the run.',
  measureMaterial: 'Which layer you measured. Measure the film itself for rates and uniformity, and the mask material too for selectivity.',
  measureUnit: 'The unit you typed the values in. They are converted on save (for example Å and µm to nm for thickness), so runs compare.',
  measureUnitFree: 'The unit of the values, as you type it. Other measurements are kept as typed, with no conversion, so use the same unit every time.',
  measurePoints: 'The value measured at each site, in the unit above. Empty points are skipped. The mean, range and uniformity below update as you type; uniformity needs two or more points.',
  measureTool: 'The tool you measured with. It is kept with the measurement and in exports; the results do not depend on it.',
  measureSites: 'Where on the wafer you measured. More sites give a better mean and uniformity; use the same pattern every time so runs compare.',
  measuredAt: 'When the measurement was taken. Results use the latest pre and the latest post measurement of each kind and material.',
  // Tool events
  eventTool: 'The tool the event happened on. A major event only changes how Lookup weighs runs on that tool.',
  eventType: 'What happened to the tool. A PM, chamber clean or target change counts as major unless you change it.',
  eventMajor: 'A major event changes how the tool behaves. Lookup then counts runs from before it less (Event penalty in Settings) and marks them “Before last …”.',
  eventWhen: 'When it happened. Runs that started before this time count as before the event.',
  eventNotes: 'What was done, parts changed, who did it.',
  // Tool settings
  toolName: 'The tool’s full name, as on the LNF wiki or the tool itself.',
  toolShortName: 'A short name for lists and buttons, for example “ICP-2”.',
  toolCategory: 'The kind of process. It sets the icon and colour, and Lookup’s Include sibling tools pools runs from tools of the same category.',
  toolKind: 'Metrology tools are the ones offered when you add a measurement to a run. Both kinds can log runs.',
  toolHalfLife: 'How fast this tool’s older runs fade from Lookup’s similar-runs average. Empty uses the Lookup tuning setting. Shorter suits a tool that drifts quickly, longer a very stable one.',
  toolNotes: 'Anything about the tool: quirks, contacts, known issues.',
  // Templates and their fields
  templateName: 'The template’s name, for example “Oxide etch”. A tool can have several templates for different processes.',
  primaryOutput: 'The main result: shown in lists and charts, and summarised first by Lookup.',
  processType: 'Sets the verb in Lookup’s suggested time (etch, deposit) and which templates count as siblings when Include sibling tools is on.',
  fieldLabel: 'The name shown on the form.',
  fieldKey: 'The name each run stores the value under. Keep it stable: runs, exports and the LNF recipes find fields by their key.',
  fieldType: 'Number: a box with − and + buttons. Text: free text. Choice: one of a list. Yes / no. Duration: minutes and seconds, stored in seconds.',
  fieldRole: 'Input: a setting you choose before the run; Lookup matches on inputs. Output: a result. Context: recorded with the run but never matched.',
  fieldUnit: 'Shown after the label, for example W, mTorr or sccm. An output in nm/min lets Lookup suggest a process time.',
  fieldStep: 'How much − and + change the value per tap.',
  fieldMin: 'The − button stops at this value. Empty: no limit.',
  fieldMax: 'The + button stops at this value. Empty: no limit.',
  fieldOptions: 'The choices, one per line. Up to 5 short options (14 characters or fewer) show as buttons; more show as a list.',
  fieldWeight: 'How much a difference in this field counts in Lookup’s distance: 1 is normal, 2 counts double, 0 leaves it out of the distance (a must-match or chemistry field still filters). Durations default to 0, because time changes the amount, not the rate.',
  fieldSpread: 'The usual run-to-run variation of this setting, in its unit. Lookup divides differences by it, so a difference this size adds the field’s weight to the distance: a smaller spread makes Lookup stricter about this field. Empty: worked out from your similar past runs once at least 4 have a value; until then, 10% of the planned value.',
  fieldExact: 'On: when you set this field in Look up, Lookup only compares runs with the same value (case and extra spaces ignored), as a filter rather than a distance.',
  fieldChemistry: 'On: this is a gas flow. With Strict chemistry, Lookup only compares runs where the same gases flow.',
  fieldRequired: 'On: a run cannot be saved as open or complete until this field has a value.',
  derivedFunction: 'The built-in calculation that fills the output from measurements.',
  derivedOutput: 'The output field that receives the value. A value typed by hand on a run replaces it.',
  derivedTime: 'The field holding the process time, read in seconds (a duration, or a number field in seconds). By default, the template’s first duration field.',
  derivedPhase: 'Which measurement’s points the uniformity uses: post (after the run) by default.',
  derivedKind: 'Which kind of measurement the calculation reads; thickness by default.',
  // Settings
  userName: 'Recorded as the author of the runs, measurements and events you log. Labmates who sync with you see it, and it is in the repository’s history of each sync.',
  deviceName: 'Sync shows it in the repository’s history, so you can tell your devices apart.',
  theme: 'System follows your device’s light or dark setting.',
  includePhotos: 'Run photos, and the pictures and files on plan steps, make the backup much bigger. They do not sync, so a backup is the way to move them to another device.',
  exportFormat: 'Excel: a workbook with all runs, a sheet per tool, the measurements and the tool events. CSV: one table of all runs, for any spreadsheet or script. PDF: a report to read or print.',
  syncRepo: 'The private GitHub repository that holds the sync files, as owner/name or its github.com address. Create it once, empty and private; every device and labmate who syncs uses the same one.',
  syncToken: 'The key that lets this device read and write the sync files. Make it as in “Set up the repository and token” below: a fine-grained token for this repository only, with Contents: Read and write. Anyone who has it can change the repository, so share it only privately.',
  syncDevice: 'Each device keeps its own file in the repository, and every sync is recorded in the repository’s history as “Sync from” this name and yours.',
  // History
  historySearch: 'Finds runs whose notes, recipe or tags contain every word you type (case ignored).',
  historyTool: 'Only runs on this tool, archived tools included.',
  historyStatus: 'Draft: not logged in full yet, from Quick capture or a run form left unsaved. Open: logged, results still to come. Complete: finished; Lookup uses complete runs that have at least one result.',
  historyTemplate: 'Only runs logged with this template of the chosen tool.',
  historyProject: 'Only the runs of this project, whichever of its wafers they processed. Finished and paused projects are listed too.',
  historyMaterial: 'Only runs on this material.',
  historyFrom: 'Only runs that started on or after this day.',
  historyTo: 'Only runs that started on or before this day.',
  // Other screens
  toolFilter: 'Shows only the tools of one category; tap it again to show them all. The search box narrows the list further.',
  installAddress: 'The web address where the app is published, for example https://you.github.io/CleanroomToolTracker/. The QR code opens it, and phones install the app from there.',
  findMaterial: 'Type to filter the list. Add puts a new material in the list that every material picker offers.',
  findMaterialHere: 'Type to filter the list. A name that is not listed is used here only; to offer it in the pickers, add it in Settings → Materials.',
  recipeSearch: 'Finds recipes by name, film, mask, gas or source; each word you type must start a word in the recipe.',
  recipeStep: 'This recipe has several steps. Choose the step whose values fill the form.',
  recipeMainStep: 'Using the recipe adds every step to the run, each with its own values. The step chosen here becomes the main step: its values are the run’s inputs, which Lookup compares. Choose the step that does the real work, for example the main etch rather than the breakthrough.',
  // Runs: time and steps
  runTime: 'How long the process ran, in minutes and seconds. Rates are worked out from this time and the measurements, so they wait for it.',
  runSteps: 'A run can have several steps, for example a breakthrough, the main etch and an over-etch, each with its own values. Tap a step to see or change its values. The main step (★) holds the run’s inputs: Lookup compares it, and rates use its time.',
  myTools: 'Search narrows the list; tap a tool to add it to your tools or take it off. Tool pickers then show your tools first, plus any tool you used in the last two months.',
  // Projects
  projectName: 'A short name you will recognise in lists, for example the device and the batch.',
  projectFolder: 'Folders keep many projects in order, for example one per thesis chapter or collaboration. Folders can hold folders. A project in no folder shows at the top of Projects.',
  projectGoal: 'What the project should achieve, in a sentence or two. It is shown on the project page and in the traveler.',
  projectStarted: 'When work on the wafers began. It orders the projects; the traveler takes its dates from the runs.',
  projectSubstrate: 'What the project’s wafers are, for example Si ⟨100⟩ or fused silica. It shows in the traveler, and the checks use it as the material of any wafer whose type gives none.',
  projectStatus: 'Active projects are offered when you log a run, and yours show on Home with their progress and next step. Paused: kept, but not offered. Finished: the work is done, and its card turns green. Failed: it ended without working out, and its card turns red. You can reopen either.',
  projectFailReason: 'What went wrong, in a sentence or two, for example “the wafer cracked in the bonder”. It shows under the project’s name and in the traveler, so the next batch can avoid it.',
  projectWaferFilter: 'All wafers: every run of the project. One wafer: only the runs that processed it, which is that wafer’s path through the process.',
  projectTime: 'The run time the runs in this project report, added up (each run’s time field and its other steps’). Then how long the steps still to do will likely take, from your past complete runs on each step’s tool and template: recent runs count most, runs from before a major tool event less, and runs with the step’s recipe alone when there are any. A step with no such runs has no estimate. Updated each time the page opens.',
  planStepTitle: 'What happens in this step, in a few words, for example “Etch the oxide” or “Strip the resist”.',
  planStepTool: 'The tool the step runs on. The step’s page then shows that tool, and Start this step saves a run on it with the step’s template and recipe.',
  planStepRecipe: 'The recipe to use, as named on the tool. Choosing one of the tool’s LNF recipes fills in its name.',
  planStepTemplate: 'The template this step uses, when the tool has several, for example the PECVD chamber of a dual-chamber tool. Start this step uses it.',
  planStepNotes: 'Anything to remember for this step: a target, a check before you start, what to watch for. Shown with the step and in the traveler.',
  projectNotes: 'Anything about the project as a whole: masks, contacts, decisions, what to watch for. Shown on the project page and in the traveler.',
  // Wafer types, plan checks and tool rules
  waferTypeName: 'A name you will recognise when you add wafers, for example “Si 100 mm DSP” or “Mask, layer 1”. It is only a label: the fields below say what the wafer is.',
  specKind: 'A mask is kept with the wafers and called a mask in projects, numbered M1, M2. Runs and checks leave masks out of “every wafer” unless a step names them, as a lithography step can.',
  specMaterial: 'What the wafer or plate is made of, for example Si, Glass, Fused silica or Soda-lime glass. The checks use it: the furnace tubes take silicon only, and anodic bonding needs a glass with sodium. A name the app does not know gets a Check where it matters. Empty: a wafer takes the project’s substrate for the checks; with neither, no check uses it.',
  specSize: 'The wafer’s diameter, a piece, or a mask plate’s side. Tools that take only some sizes (a 4 in furnace tube, a coater for 4 and 6 in wafers) are checked against it, and a smaller wafer may need a carrier wafer.',
  specPieceSize: 'How big the piece is, for example 10 × 10 mm. Kept for reference.',
  specThickness: 'Nominal thickness in µm, and ± for the tolerance when the supplier gives one (525 ± 25 µm). The checks add up a bonded stack’s thickness and compare it with a tool’s limit, for example 1000 µm on the TEL coater.',
  specPolish: 'Which sides are polished. Fusion bonding needs polished, flat surfaces; double-side polished wafers also allow backside alignment.',
  specDoping: 'The doping as bought, and the dopant: B for p-type; P, As or Sb for n-type. Kept for reference; the checks do not use it.',
  specResistivity: 'As the supplier states it, for example 1–10 Ω·cm. Kept for reference.',
  specOrientation: 'The crystal orientation of the surface, for example ⟨100⟩, with any off-cut in the same text (⟨100⟩ 4° off). It matters for anisotropic wet etches such as KOH; the checks do not use it.',
  specCut: 'For crystals such as quartz, LiNbO3, LiTaO3 or sapphire: the cut or plane, for example Z-cut, 128° Y-cut, AT-cut or C-plane. Kept for reference.',
  specGrade: 'The supplier’s grade, for example Prime, Test or Mechanical; for mask plates, Master. Kept for reference.',
  specFilms: 'Films already on the wafer when it arrives, for example 2 µm of oxide on a store wafer, with their thickness in nm. The checks start from them: a metal film counts as metal on the wafer.',
  specCoating: 'The mask’s absorber layer, for example chrome or low-reflectance chrome.',
  specResist: 'Resist already on a mask blank, for example AZ1518, 400 nm. Kept for reference.',
  specPolarity: 'Clear field: the pattern is chrome on a clear plate. Dark field: the plate is chrome with clear openings.',
  specDesign: 'The design and layer the mask carries, for example “Resonator v2, layer 1 (metal)”.',
  specVendor: 'Who sold it and their part number, so the same wafers can be ordered again.',
  specNotes: 'Anything else about this wafer or mask type.',
  addWaferCount: 'How many wafers or masks to add. They are numbered after the highest number already used: W5, W6 for wafers, M1, M2 for masks.',
  addWaferType: 'What the new wafers are: one of your wafer types, an LNF store item, or Not set to say later. Each wafer gets its own copy of the type’s details, so changing the type later leaves these wafers as they are.',
  stepWafers: 'The wafers, and masks, this step is for. None chosen: every wafer in process. A wafer bonded into a stack brings the whole stack. Start this step links these wafers to the run.',
  stepBonds: 'Which wafers this step bonds together. After it each stack goes through the plan as one: the checks add up its thickness and keep what each wafer carried. Pair them proposes pairs; Pair them myself lets you tap the wafers of each stack.',
  bondMethod: 'How the stacks are bonded. The checks use it: anodic bonding needs a sodium glass against silicon, fusion bonding needs polished surfaces, and adhesive or temporary bonds leave a polymer in the stack.',
  stepDebond: 'On: the stacks among this step’s wafers come apart here, for example after a temporary bond. Each wafer goes on as it was bonded, less what came off the stack meanwhile, and with what the stack picked up since (the adhesive, later films). A debond in a solvent, at a wet bench or with the mount’s LNF recipe takes the adhesive off; a dry one (a hot plate slide) leaves it for a later clean.',
  typeForOthers: 'On: the type you pick goes to every other wafer (or mask) in this project that has no type yet, so a batch takes one tap.',
  stepAdds: 'Materials this step leaves on the wafers, separated by commas, for example Cr, Au. Steps with an LNF deposition or plating recipe add its film, and spin-coat steps their resist (“Photoresist” unless you name it here), on their own. A metal added here counts as metal on the wafers for every later step; a name the app does not know gets a Check where it could matter.',
  stepRemoves: 'Materials this step removes completely, separated by commas, for example a blanket oxide strip. Steps named strip, ash, lift-off, piranha or wax removal remove resist on their own, and a mount’s wax or adhesive once the wafers are apart.',
  planChecks: 'Each step is checked against what its tool takes: wafer size and pieces, thickness, substrate, the materials on the wafers and how clean they are. An unknown material gets a Check, with a What is …? button, where a rule could apply. Each note says what it rests on: the LNF wiki notes, general practice or a setting made here. The LNF’s rules and the tool engineer come first. Notes never stop you saving.',
  toolSizes: 'The wafer sizes this tool takes. Plan steps with other sizes get a note. The LNF notes give some tools their sizes or a limit (up to 150 mm, a ticket for 150 mm); your choice here replaces them, and Any size means no size check. A change here goes to everyone who syncs.',
  toolPieces: 'Whether pieces can go in: Yes, On a carrier wafer, Ask staff first (a helpdesk ticket), or No. Not set: no check.',
  toolMaxThickness: 'The thickest wafer or bonded stack it takes, in µm. Empty: no upper limit. A thinnest wafer from the LNF notes (the TEL coater’s 200 µm) is said below the box and still checked.',
  toolMasks: 'The mask plate sizes it takes, for aligners, mask makers and mask benches. None chosen: no check.',
  toolExcludes: 'Materials not allowed in this tool. A wafer that carries one gets a note at this step.',
  folderName: 'The folder’s name, as Projects shows it. Two folders in the same place need different names.',
  folderPlace: 'Where the folder goes: the top of Projects, or inside another folder.',
  runWafers: 'Which of the project’s wafers went through this run. Each wafer’s path in the traveler lists the runs that name it. Finished and scrapped wafers are left out unless the run already names them.',
  runPlanStep: 'The planned step this run carries out. A complete run linked to a step marks it done; a draft or open run shows it as in progress.',
  gasLines: 'The template’s other gas lines, hidden while this run does not use them. Tap one to show its box. A gas left empty counts as off, in Lookup too.',
  // Run steps, measurements and charts
  stepName: 'A short name for this step, for example “Breakthrough”, “Main etch” or “Over-etch”. It shows on the step’s button and in exports.',
  pasteValues: 'Paste from the metrology tool’s software or a spreadsheet: a column, a row, or “site = value” pairs. The numbers fill the sites in order, or by name when every pasted site matches one here.',
  scatterInput: 'The input along the bottom of the chart. Only inputs set to at least two different values in complete runs are offered. The line is a least-squares fit through the points.',
});
