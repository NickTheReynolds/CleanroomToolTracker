# Data model

LNF Run Log stores everything in one IndexedDB database named `lnf-runlog` on the device. There are seven object stores. Tool **templates** drive every form and the lookup.

The code that defines this model:

- `app/js/data/schema.js`: store layout, migrations, normalisation and validators.
- `app/js/core/types.js`: JSDoc types.
- `app/js/core/vocab.js`: allowed values.

## Common fields

Every record in the six data stores (`meta` excluded) has:

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
| `runs` | `toolId`, `templateId` (null for an untyped quick capture), `material`, `substrate`, `maskMaterial`, `status` (draft, open, complete), `startedAt`, `endedAt`, `params` {key: value}, `results` {key: value}, `derivedKeys[]`, `targetThickness` (nm or null), `recipe`, `notes`, `tags[]`, `photoIds[]` | `toolId`, `toolTemplate` = [toolId, templateId], `startedAt`, `status` |
| `measurements` | `runId`, `metrologyToolId`, `kind` (thickness, stepHeight, cd, sheetResistance, refractiveIndex, stress, other), `phase` (pre, post), `material`, `unit`, `points[]` {site, value}, `takenAt`, `notes` | `runId` |
| `events` | `toolId`, `type` (pm, clean, seasoning, targetChange, gasChange, fault, other), `major`, `at`, `notes` | `toolAt` = [toolId, at] |
| `photos` | `runId`, `blob` (JPEG), `width`, `height`, `caption`, `takenAt` | `runId` |
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

### Photos

Photos are resized on the device to at most 1600 px on the long edge and stored as JPEG blobs, at quality 0.8 (`PHOTO_MAX_EDGE`, `PHOTO_QUALITY`). Very old Safari versions cannot store blobs in IndexedDB; there the record holds `bytes` (an ArrayBuffer) and `type` instead of `blob`.

## Template field spec

| Property | Type | Meaning |
|---|---|---|
| `key` | string | Stable key used in `params` and `results`. It must start with a letter and use only letters, digits and `_`. Once runs use a key, the editor locks it. |
| `label`, `unit` | string | Shown in the form. |
| `type` | number, text, select, bool, duration | Duration is stored in seconds and entered as minutes and seconds. |
| `role` | input, output, context | Inputs drive lookup; outputs are results; context is recorded but never matched. |
| `required` | bool | Default false. At most 5 per template. Required fields must be filled before a run is saved as open or complete; drafts may leave them empty. |
| `step`, `min`, `max` | number | Stepper increment and bounds. Duration steps default to 10 s. A number field without `min`, or with `min` < 0, shows a ± button, because phone number pads have no minus key. |
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
| `tuning` | `{halfLifeDays, eventPenalty, topK}` lookup overrides | yes; imports leave local tuning unchanged |
| `lastExportAt` | Time of the last backup export (drives the Home reminder) | no |
| `iosHintDismissed`, `persistAsked`, `firstRunAt` | Device housekeeping | no |
| `publicUrl` | The published HTTPS address, for the install QR code | no |
| `sync` | GitHub sync: `{repo, token, seen: {deviceId: blobSha}, lastSyncAt, lastResult}` | no, and the token never leaves the device |

`meta.seedVersion` records which seed the database has: 1 is the generic examples, 2 is the LNF equipment list. Older databases are upgraded once (see `data/seed-upgrade.js`). The upgrade only adds records that are missing, merges new materials, and archives example tools that were never used or edited.

## Drafts (`meta` keys `draft:<form>`)

Every in-progress form autosaves its state about 300 ms after each change, and immediately when the page is hidden. Each form has its own key: `log`, `capture`, `lookup`, `event:<id>`, `measure:<id>`, `tool:<id>` and `template:<id>`. A run being logged gets its id when the form opens, so photos taken before Save are stored at once under that id. Discarding the form removes those photos.

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

**Using a recipe** (`recipeFill` in `core/recipes.js`): the chosen step's values go into the template fields with the same key, when the field exists, has the role being filled and the value suits its type (a number for number and duration fields, one of the options for choice fields). Gas fields the step does not use are cleared when the step gives any gas flow, because a recipe names its whole chemistry; a gas it lists without one number ("ramped") stays as it is. The recipe's name goes into the run's `recipe`, and its film into `material` when it names exactly one. Everything else stays, and Undo (`undoFill`) takes back only what the recipe changed. Lookup fills input fields only, and keeps cleared gases as empty values so Log this run does not bring back the last run's gases.

`test/recipes.test.mjs` checks every shipped recipe against its tool's seeded template: the keys exist, the values suit the fields, units match and the step indexes are valid.

## Versions and migrations

- **`DB_VERSION`** is the IndexedDB structural version (object stores and indexes).
- **`SCHEMA_VERSION`** is the record format version. It is stored in `meta.schemaVersion` and in every backup.
- **`MIGRATIONS`** in `schema.js` is the ordered list of migrations. Each step lists the stores and indexes to create and, optionally, a function that upgrades one record from the previous version. Older backups are upgraded with the same functions during import. A backup from a newer format is refused with a message asking to update the app.

## LNF wiki links and tool photos

`data/lnf-wiki.js` maps each LNF tool id to its place on the LNF wiki: `{page, image?, processes?, docs?}`. That is the page title, the path of the photo on that page, the title of its process (recipe) page, and `[label, address]` pairs for the documents the page links (SOPs, system overviews, process sheets). `wikiPageUrl(title)` builds a page address. Tools you add yourself have no entry.

The app ships tool photos in `app/img/tools/`, named after the wiki file, at most 480 px on the long edge. `data/tool-photos.js` lists them, and the service worker precaches them. A tool whose photo is not shipped shows it from the wiki when the wiki is reachable, and its category icon otherwise. `scripts/tool-photos.mjs` (`npm run photos`) fetches and shrinks the missing photos and rewrites both lists.

## Export everything

Settings → Backup and data writes one file of the live records (no tombstones), built on the device by `core/export-all.js`:

- **CSV** (`lnf-runlog-all-<date>.csv`): one row per run, oldest first. It has the run's facts, a `p.<key>` column per parameter, an `r.<key>` column per result, `m.<phase>.<kind> [<unit>]` with the mean of the latest such measurement of the run's material (a blank material counts as the run's), `m.<phase>.<kind> <material> [<unit>]` for any other material measured, such as the mask, every measurement in words, and the ISO 8601 start and end. `date` is local time.
- **Excel** (`.xlsx`, `core/xlsx.js`): the same table as "All runs", then one sheet per tool with labelled columns ("ICP power (W)", durations in seconds), then "Measurements" (one row per measurement, with its points) and "Tool events". Times are Excel dates in local time; the first row is bold, frozen and filterable.
- **PDF** (`core/pdf.js`): a report, tool by tool and run by run, with inputs, conditions, results, sample, measurements, notes and tags, then the tool's events. It uses the standard Helvetica fonts and WinAnsi text; characters outside it are spelled out ("Ω" becomes "Ohm") or shown as "?".
