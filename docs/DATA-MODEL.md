# Data model

LNF Run Log stores everything in one IndexedDB database named `lnf-runlog` on the device. There are ten object stores. Tool **templates** drive every form and the lookup.

The code that defines this model:

- `app/js/data/schema.js`: store layout, migrations, normalisation and validators.
- `app/js/core/types.js`: JSDoc types.
- `app/js/core/vocab.js`: allowed values.

## Common fields

Every record in the nine data stores (`meta` excluded) has:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | UUID v4. Seed records use fixed UUIDs (see below). |
| `createdAt` | ISO 8601 string | When the record was first saved. |
| `updatedAt` | ISO 8601 string | When it was last saved. Every write moves it strictly forward, by at least 1 ms, so merges can trust it. |
| `deleted` | boolean | Soft delete. Deleted records stay as tombstones; nothing is physically removed. |
| `deviceId` | string | The device that last wrote the record. Phase 2 sync breaks ties with it. |
| `author` | string | Who created the record: the user name in Settings at creation time. Edits keep the original author. |

## Stores

| Store | Key fields | Indexes |
|---|---|---|
| `tools` | `name`, `shortName`, `category` (etch, deposition, thermal, litho, metrology, other), `kind` (process, metrology), `active`, `defaultTemplateId` (or null), `halfLifeDays` (null means use the setting), `notes` | `category` |
| `templates` | `toolId`, `name`, `processType` (same values as category), `fields[]`, `derived[]`, `primaryOutput` (an output key, or null) | `toolId` |
| `runs` | `toolId`, `templateId` (null for an untyped quick capture), `material`, `substrate`, `maskMaterial`, `status` (draft, open, complete), `startedAt`, `endedAt`, `params` {key: value}, `results` {key: value}, `derivedKeys[]`, `targetThickness` (nm or null), `recipe`, `notes`, `tags[]`, `photoIds[]`, `steps[]` (see Run steps), `projects[]` (see Projects) | `toolId`, `toolTemplate` = [toolId, templateId], `startedAt`, `status` |
| `measurements` | `runId`, `metrologyToolId`, `kind` (thickness, stepHeight, cd, sheetResistance, refractiveIndex, stress, other), `phase` (pre, post), `material`, `unit`, `points[]` {site, value}, `takenAt`, `notes` | `runId` |
| `events` | `toolId`, `type` (pm, clean, seasoning, targetChange, gasChange, fault, other), `major`, `at`, `notes` | `toolAt` = [toolId, at] |
| `photos` | `runId` (the run, or since 1.6 the plan step, it belongs to), `blob` (JPEG; a step's file as picked), `width`, `height`, `caption`, `takenAt`; a step's picture or file also has `name` and `type` | `runId` |
| `projects` | `name`, `goal`, `status` (active, paused, done), `startedAt`, `endedAt`, `substrate`, `notes`, `folderId` (or null), `wafers[]`, `steps[]` (see Projects), and optionally `failed` and `failReason` | `status` |
| `folders` | `name`, `parentId` (a folder, or null for the top level) | none |
| `wafers` | Saved wafer types: `name`, `spec` (a WaferSpec, see Wafer types). Masks are kept here too, with `spec.kind: "mask"`. | none |
| `meta` | keyed by `key`: `schemaVersion`, `settings`, and `draft:<form>` entries | none |

### Values in `params` and `results`

A value is a number, text, `true`/`false`, or `null`. Durations are stored in seconds. Keys are template field keys. A key that a template no longer has stays on the run: it is never deleted, still exported, and listed on the run under "Other values".

### Derived results

`results` holds both typed and derived outputs. `derivedKeys` lists the keys whose values were computed by a built-in function (`app/js/core/derive.js`). A key that is in `results` but not in `derivedKeys` was entered by hand, and a hand-entered value always wins. Derived values are recomputed on every run save and every measurement change. They are stored at full precision.

### Measurements

- **Units.** Thickness and step height are stored in nm; Å (÷ 10) and µm (× 1000) are converted on entry. Critical dimension is stored in µm, and nm (÷ 1000) is converted on entry. Sheet resistance is stored in Ω/sq and stress in MPa. Refractive index has no unit. Kind "other" keeps the unit as typed.
- **Mean.** A measurement's mean is the arithmetic mean of its points.
- **Material.** A measurement with a blank material counts as the run's own material.
- **Several matches.** When several measurements match the same phase, kind and material, the latest by `takenAt` is used.

### Run steps

A run with several steps (a breakthrough, the main etch and an over-etch, or the layers of a stack) lists them in `steps`, in order: `{name, main: true}` for the main step and `{name, params}` for each other step. Exactly one step is the main step, and its values are the run's `params`. So Lookup, the derived results and every export keep reading `params`, and a one-step run simply has `steps: []`. Steps are stored tidy: names trimmed (a blank one becomes "Step n") and empty values dropped (`tidySteps`). Using a multi-step LNF recipe in a run form fills every step; the step chosen in the recipe sheet becomes the main step. A recipe with one step or none fills the main step and keeps the run's other steps. Duplicating a run or prefilling from the last run copies the steps, keeping only the input and condition fields the template knows. Exports write the steps as one text column (`stepsText` in `core/run-steps.js`).

### Wafer types, wafer specs and bonds

- A **WaferSpec** says what a wafer or mask is. Every field is optional and empty means not known: `kind` (`mask`, or left out for a wafer), `material`, `size` (`50mm`, `76mm`, `100mm`, `150mm`, `200mm`, `300mm`, `piece`; mask plates `plate4` to `plate7`), `pieceSize`, `thicknessUm` and `thicknessTolUm` (µm), `orientation`, `cut`, `polish` (`ssp`, `dsp`, `none`), `doping` (`p`, `n`, `undoped`), `dopant`, `resistivity` (text as stated), `grade`, `films` (`[{material, thicknessNm}]` already on it), and for masks `coating`, `resist`, `polarity` (`clear`, `dark`), `design`; then `vendor`, `partNo`, `notes`. `cleanSpec` in `core/wafer-spec.js` tidies one for storage and keeps fields it does not know.
- The **wafers** store holds the person's types. The LNF store's single items are not stored: they ship in `data/lnf-store.js` (from the owner's screenshots of the store on 2026-10-22, names and descriptions verbatim, prices with that date, no stock) and change only in a release.
- A project's wafer may carry `spec` (its own copy, so editing a type later does not rewrite a project's history) and `specId` (the type's id or `lnf-store/<slug>`, where it came from).
- A plan step may carry `waferIds` (which wafers and masks it is for; none means every wafer in process, masks left out when the project has wafers), `bonds` (`[{id, waferIds, method}]`: the stacks it bonds), `debond` (the stacks among its wafers come apart), `adds` and `removes` (material names), and `checked` (the compatibility notes marked as checked, by `noteKey`).
- A tool may carry `compat`: the person's settings for the plan's checks (`sizes`, `pieces`, `maxThicknessUm`, `masks`, `excludes`, and `accepts`/`marks`), field by field over the profile the app ships (`data/compat-lnf.js`). `null` means "no check" for that field. Choosing sizes also stores `maxDiameterMm` and `askSizes` as `null`, setting the LNF notes' size limits aside; a thinnest wafer from the LNF notes (`minThicknessUm`) has no setting.
- None of these fields gets a default when records are read or normalised: readers treat a missing one as not set, so records written by 1.4 stay exactly as they were.

### Projects and folders

A project follows a batch of wafers through a process.

- A project that ended without working out is **failed** (1.8): `status` done, `failed: true`, and `failReason`, what went wrong (text, may be empty). `projectStatus` in `core/projects.js` reads the four statuses people see (active, paused, finished, failed); `failed` counts only on a done project.
  - **Older versions** check `status` against the three they know, so "failed" is never stored there: they accept a failed project, show it as finished and keep both fields when they save it.
  - **Copies** start active, without either field.
- `wafers[]`: `{id, label, status (active, done, scrapped), notes}`. Ids are UUIDs, so a wafer can be renamed.
- `steps[]`: the plan, in order: `{id, title, toolId, templateId, recipe, notes, doneAt, skipped}`. `toolId`, `templateId` and `doneAt` may be null. A step is **done** when a complete run is linked to it, or when it was marked done by hand (`doneAt`); **in progress** when a draft or open run is linked to it; **skipped** when marked so. Progress counts done steps out of the steps not skipped.
- A plan step may carry `attachments` (`[{id, name, kind (photo, file), type, size, addedAt}]`) and, on an exposure step, `gds` (`{name, cell, layer, link, fileId, size}`, every part but the name optional). New in 1.6 (`core/attachments.js`, `data/attachments.js`):
  - **What syncs.** These lists sync with the project.
  - **Where the bytes are.** They stay on the device that added them, in the `photos` store under the same id, with `runId` set to the step's id. Another device shows the name and size and says the file is on another device.
  - **Copies.** A copied project keeps each step's `gds` (sharing the file on this device), but not its attachments.
  - **Deleting.** A file's bytes are deleted, as a tombstone, only when no live step names them (`fileInUse`).
- A run joins a project from its own side: `run.projects[]` holds `{projectId, waferIds[], stepId}` links. One run can carry wafers of several projects (a furnace load), and a run without links is a run without a project. A project's traveler is its linked runs, oldest first; a wafer's path is the runs whose link names it.
- Deleting a project leaves its runs alone; their links to it are ignored. Wafers and steps that runs name cannot be removed from the project, only finished, scrapped or skipped.
- `folderId` files the project in a folder. Folders hold folders through `parentId`. A folder whose parent was deleted, or a loop of folders that two devices moved into each other at the same time, shows at the top level: in a loop, the folder with the lowest id (`folderTree` in `core/folders.js`), so every device draws the same tree. A project in a deleted folder shows at the top level too.
- Deleting a folder either moves what it holds up into its parent (a moved folder whose name is taken there becomes "Name (from Deleted)"), or deletes the folder, its folders and its projects (as tombstones, with Undo). `folderDeletePlan` in `core/folders.js` works out the change.

### Photos

Photos are resized on the device to at most 1600 px on the long edge and stored as JPEG blobs, at quality 0.8 (`PHOTO_MAX_EDGE`, `PHOTO_QUALITY`). A plan step's pictures are resized the same way; its other files are stored as picked, up to 100 MB each (`MAX_FILE_BYTES`). Very old Safari versions cannot store blobs in IndexedDB; there the record holds `bytes` (an ArrayBuffer) and `type` instead of `blob`.

## Template field spec

| Property | Type | Meaning |
|---|---|---|
| `key` | string | Stable key used in `params` and `results`. It must start with a letter and use only letters, digits and `_`. Once runs use a key, the editor locks it. |
| `label`, `unit` | string | Shown in the form. |
| `type` | number, text, select, bool, duration | Duration is stored in seconds and entered as minutes and seconds. |
| `role` | input, output, context | Inputs drive lookup; outputs are results; context is recorded but never matched. |
| `required` | bool | Default false. At most 5 per template. Required fields must be filled before a run is saved as open or complete; drafts may leave them empty. |
| `step`, `min`, `max` | number | Stepper increment and bounds. Duration steps default to 10 s. A number field shows a ± button, because phone number pads have no minus key, when it can be negative: its `min` is below 0, or it has no `min` and holds a temperature in °C, a stress, a voltage, a focus, an offset or a bias (`signedField` in `ui/fields.js`). |
| `options` | string[] | Choices for select fields. |
| `weight` | number | Distance weight. Default 1; duration fields default to 0. 0 means lookup ignores the field. |
| `spreadHint` | number | Typical variation, used to normalise distance. |
| `matchExact` | bool | A select, text or bool input becomes a hard filter in lookup. |
| `chemistry` | bool | A gas-flow number input used by the strict chemistry filter. |

### Derived entries

`{output, fn, timeField?, phase?, kind?}` maps an output key to one of the built-in functions:

- `etchRate`, `depRate`
- `removed`, `deposited`
- `uniformity`, `uniformityStd`
- `selectivity`

`timeField` defaults to the template's first duration field. `phase` applies to the uniformity functions and defaults to post. `kind` defaults to thickness. The formulas are in `docs/ALGORITHM.md` and `core/derive.js`.

## Settings (`meta` key `settings`)

| Key | Meaning | In backups |
|---|---|---|
| `userName` | Recorded as `author` on new records | no |
| `deviceName` | A label for this device | no |
| `deviceId` | Random UUID created on first run | no |
| `theme` | system, light or dark | no |
| `materials` | Material picker list | yes; imports merge it as a union |
| `materialKinds` | What the person said materials are, for the plan checks: `{[normText(name)]: {name, kind, at}}`. `kind` is a `MaterialKind` (`core/wafer-spec.js`), or `""` once taken back, so taking an answer back syncs too. An answer only fills in what the app does not know (a material, or the kind of wafer a known film makes); it never changes what the app reads. A name with an answer is on the materials list. New in 1.5.1. | yes, and in sync files; for each material the newer answer wins |
| `tuning` | `{halfLifeDays, eventPenalty, topK}` lookup overrides | yes; imports leave local tuning unchanged |
| `lastExportAt` | Time of the last backup export (drives the Home reminder) | no |
| `iosHintDismissed`, `persistAsked`, `firstRunAt` | Device housekeeping | no |
| `publicUrl` | The published HTTPS address, for the install QR code | no |
| `sync` | GitHub sync: `{repo, token, seen: {deviceId: blobSha}, seenStores, lastSyncAt, lastResult}`. `seenStores` names what `seen` covers (`SYNC_SCOPE`: the stores and, since 1.5.1, the answers about materials), so a version that syncs more reads every file again once | no, and the token never leaves the device |
| `myTools` | Ids of the tools this person uses; tool pickers show them (and tools used in the last 60 days) first | no |

`meta.seedVersion` records which seed the database has: 1 is the generic examples, 2 is the LNF equipment list, 3 adds a PECVD template for the Plasmatherm 790's second chamber (`LNF_EXTRA_TEMPLATES` in `data/seed-lnf.js`, fixed id), 4 adds an Expose time field to the Heidelberg µPG 501's template (`LNF_ADDED_FIELDS`). Older databases are upgraded once (see `data/seed-upgrade.js`). The upgrade adds records that are missing (a deleted one stays deleted) and the fields `LNF_ADDED_FIELDS` lists to stored templates that lack them (saved as an edit), merges new materials, and archives example tools that were never used or edited.

## Drafts (`meta` keys `draft:<form>`)

Every in-progress form autosaves its state about 300 ms after each change, and immediately when the page is hidden. Each form has its own key: `log`, `capture`, `lookup`, `history`, `event:<id>`, `measure:<id>`, `tool:<id>`, `template:<id>`, `project:<id>` (`project:new` for a new one) and `project:copy:<id>` for a copy of project `<id>`. The Log run draft also keeps the timer (`timerStartedAt`, `timerTarget` for a countdown, `timerRan`), and `touched`: only a form someone changed is offered for resuming or kept as a draft run. A run being logged gets its id when the form opens, so photos taken before Save are stored at once under that id. Discarding the form removes those photos.

## Seed data

On first run the app writes the LNF equipment list (`data/seed-lnf.js`). That is 127 tools from the LNF wiki, each with its own copy of the generic template for its type (`data/seed-types.js`), plus the materials list. Seed records have fixed UUIDs and the timestamp `2026-01-01T00:00:00.000Z`, so backups and syncs from two devices merge without duplicates, and any later edit, such as renaming a tool, wins the merge. LNF ids are derived from the tool name (SHA-256, formatted as a v4 UUID).

- `LNF_TOOLS` rows are `[toolId, templateId, name, type, gases]`. `type` picks the template builder; metrology types without inputs (SEM, microscope, XRD) get no template.
- `LNF_MATERIALS` lists every material the wiki lists as supported, one name each, plus "LiNbO3 (bulk)".
- `LNF_MATERIAL_WORDS` maps a material to the wiki's other names for it, so the material search finds "gold".

The older generic examples (`data/seed-tools.js`, names ending in "(example)") are seed version 1. The upgrade archives the ones you never used.

## LNF recipes

The recipes the LNF wiki documents ship with the app as reference data in `data/lnf-recipes-etch.js`, `lnf-recipes-dep.js` and `lnf-recipes-other.js`, one recipe per line. `data/recipes.js` loads them the first time a screen needs them. They are not records: they are not stored in IndexedDB, backed up, exported or synced, and a new app version replaces them. A run keeps only the recipe's name, in its `recipe` text, as before.

Each recipe (`WikiRecipe` in `core/recipes.js`):

| Field | Meaning |
|---|---|
| `id` | Stable and unique: `<tool>/<recipe>` in slug form. |
| `tool` | The tool's id (the fixed LNF seed id). |
| `name`, `about` | The name as the wiki writes it, and one plain sentence. |
| `films`, `mask`, `gases` | What it etches, deposits or treats (app material names where one matches), mask materials, and gases. |
| `steps[]` | `{name, values[]}` per process step, in order. A value is `{l, v, u, k, t}`: the wiki's label, the value, its unit, the key of the generic template field it fills (only for the same physical quantity, with `v` converted to that field's unit; durations in seconds), and the wiki's own wording when it differs ("5 min", "variable"). |
| `main` | The step that fills a run form; -1 when the wiki gives no parameters. |
| `results`, `expect` | Expected results as short lines, and as numbers keyed by template output (`{etchRate: 181}`). |
| `notes` | Caveats from the source. |
| `src`, `url`, `date` | The source (a wiki page, or a sheet, document or PDF a wiki page embeds or links), its address, and the date of the copy read. |
| `caveat` | Optional: why to check the recipe before relying on it (its sources disagree or are unclear). |
| `process` | Optional: the process type of the template the recipe fills, on a tool with templates of two types (every Plasmatherm 790 recipe says `etch` or `deposition`). On such a tool a run form lists the recipes of its template's type and those that name none (`recipesFor`), and "Log run with this recipe" opens the matching template (`templateForRecipe`). The tool's default template plays no part. |

**Using a recipe** (`recipeFill` in `core/recipes.js`, `recipeForForm` in `core/run-steps.js`): the chosen step's values go into the template fields with the same key, when the field exists, has the role being filled and the value suits its type (a number for number and duration fields, one of the options for choice fields). Gas fields the step does not use are cleared when the step gives any gas flow, because a recipe names its whole chemistry; a gas it lists without one number ("ramped") stays as it is. In a run form, a recipe with several steps fills every step, and the chosen step becomes the run's main step. The recipe's name goes into the run's `recipe`. Its film goes into `material` only when the form has no material yet and the film names exactly one listed material (`recipeMaterial`): "SiNx" becomes "SiNx (PECVD)" when that is the only SiNx, but "SiO2" (thermal, PECVD or LTO?) sets nothing, so a run never gets a name that Lookup's Same material rule would not match. Everything else stays, and Undo (`undoFill`) takes back only what the recipe changed. Lookup fills input fields only, and keeps cleared gases as empty values so Log this run does not bring back the last run's gases. A recipe that only names itself, with no values, is listed last with the badge "Name only".

`test/recipes.test.mjs` checks every shipped recipe against its tool's seeded template: the keys exist, the values suit the fields, units match and the step indexes are valid.

## Versions and migrations

- **`DB_VERSION`** is the IndexedDB structural version (object stores and indexes): 1 is the first layout, 2 added `projects`, 3 added `folders`, 4 added `wafers`. `DB_LAYOUT` in `schema.js` lists the stores and indexes each version adds; opening the database creates whatever an older one lacks.
- **`SCHEMA_VERSION`** is the record format version. It is stored in `meta.schemaVersion` and in every backup. It is still 1: run steps, project links, projects, folders, wafer types, wafer specs, bonds and tool compatibility settings only add to the format: every new field either has a default or is optional (a missing one reads as not set), and an older app version keeps the fields it does not know and skips the stores it does not know. So devices on different versions keep syncing, and a backup from this version imports into an older one, without the stores that version lacks (projects and folders before 1.4, saved wafer types before 1.5) and without the answers about materials (before 1.5.1, which travel as a settings field older versions ignore).
- **`MIGRATIONS`** in `schema.js` is the ordered list of record migrations: a function that upgrades one record from the previous format. Older backups are upgraded with the same functions during import. A backup from a newer format is refused with a message asking to update the app.

## LNF wiki links

`data/lnf-wiki.js` maps each LNF tool id to its place on the LNF wiki: `{page, processes?, docs?}`. That is the page title, the title of its process (recipe) page, and `[label, address]` pairs for the documents the page links (SOPs, system overviews, process sheets). `wikiPageUrl(title)` builds a page address. Tools you add yourself have no entry.

The app never loads anything from the wiki: these are links, opened in the browser only when tapped (DECISIONS.md 77). New wiki information reaches the app in a release.

## Export everything

Settings → Backup and data writes one file of the live records (no tombstones), built on the device by `core/export-all.js`:

- **CSV** (`lnf-runlog-all-<date>.csv`): one row per run, oldest first. It has the run's facts, a `p.<key>` column per parameter, an `r.<key>` column per result, `m.<phase>.<kind> [<unit>]` with the mean of the latest such measurement of the run's material (a blank material counts as the run's), `m.<phase>.<kind> <material> [<unit>]` for any other material measured, such as the mask, every measurement in words, and the ISO 8601 start and end. `date` is local time.
- **Excel** (`.xlsx`, `core/xlsx.js`): the same table as "All runs", then one sheet per tool with labelled columns ("ICP power (W)", durations in seconds), then "Measurements" (one row per measurement, with its points) and "Tool events". Times are Excel dates in local time; the first row is bold, frozen and filterable.
- **PDF** (`core/pdf.js`): a report, tool by tool and run by run, with inputs, conditions, results, sample, measurements, notes and tags, then the tool's events. It uses the standard Helvetica fonts and WinAnsi text; characters outside it are spelled out ("Ω" becomes "Ohm") or shown as "?".

Every run row also names the run's projects (with its wafers and plan step) and its steps. The workbook gets a "Projects" sheet when there are projects: each project's folder, status, dates, wafers, steps done and runs, and what went wrong for a failed one.

## A project's traveler

The project page exports its traveler (`core/project-report.js`): every run the project's wafers went through, oldest first, with the plan and each wafer's path.

- **PDF** (`lnf-runlog-project-<name>-<date>.pdf`): the project's facts (folder, goal, substrate, wafers, notes), the plan with each step's state, the process record run by run (inputs, results, measurements, wafers, step) and each wafer's path.
- **Excel** (`.xlsx`): the sheets "Process record", "Plan" and "Wafers".
- Each step in the plan names its GDS layout and its pictures and files (in the workbook, the Plan sheet's last two columns). The files themselves are not in the traveler.
