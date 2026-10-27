# Changelog

One entry per milestone (spec Section 16).

## M9: Wafer and mask types, bonding, and plan checks

Version 1.5.0.

- **Wafer types.** Say what a project's wafers are: material, size (2 in to 200 mm, pieces), thickness and tolerance, orientation, cut, polish, doping and dopant, resistivity, grade, and the films already on them.
  - **Settings → Wafer types** keeps your own types and lists the **LNF store's** 13 single wafers and mask plates, with the store's own names and descriptions and the prices seen on Oct 22, 2026. **Copy to your types** makes an editable copy.
  - **Add wafers** asks how many and of which type, in one sheet. Four store wafers in a new project take four taps and become W1–W4.
  - Each wafer's type is one button on its row. Choose a type for one wafer or for all those without one, or edit the details and save them as a new type.
  - Each wafer keeps its own copy of its type, so editing a type later never changes a project's history.
- **Masks are wafers of kind mask.** They are numbered M1, M2, use plate sizes (4 to 7 in) and have mask fields (coating, resist on the blank, polarity, design and layer). Runs and checks leave them out of "every wafer" unless a step names them.
- **Bonding.** A step on a bonder bonds wafers into stacks, and one on the Sample mounting station mounts them on a carrier (a temporary bond): **Pair them** proposes pairs in one tap, or tap the wafers of each stack yourself, and choose the bond method once. After the bond, a step or run that names one wafer takes the whole stack (tapping one wafer of a stack in a run picks the stack). A later step can debond; a debond in a solvent takes the mount's adhesive off, a dry one leaves it for a later clean.
- **Plan checks.** Each step is checked against what its tool takes: wafer size and pieces (with carriers), thickness (a stack's adds up), substrate, the materials on the wafers, how clean they are (metal on a wafer, a step on an evaporator, sputter or plating tool even for a dielectric, dicing, and metals-class and non-CMOS solvent benches leave wafers out of CMOS-clean tools for good), the last wet bench before the PFC clean, and KOH waiting to be cleaned off.
  - The facts come from the **LNF wiki notes** the app already ships (the furnace tubes' sizes, silicon only and the PFC Bench 01 clean right before; PFC Bench 01 taking no wafers from wet benches other than Acid 02 or RCA 81; KOH cleaning in order, Piranha and SC2 at Acid 92 then RCA at RCA 81, and a KOH developer at Base Bench 63 keeping wafers out of clean tools; carriers on the P5000 PECVD, Synapse and Pegasus 6; mask plates on the mask maker and mask bench) and from **general practice** (evaporator, sputter and plating tools; the bond methods; a mask plate wider than the wafer). Every note says which, and the LNF's rules and the tool engineer come first.
  - Notes show on each plan step while you edit, on the project page (the next step's card, badges on the plan, the step's sheet), on **Log run** under the project's step, and in the traveler export. Each starts with **Not allowed** or **Check** and ends with what it rests on.
  - **Mark as checked** quiets a note; **Add the PFC Bench 01 clean before this step** fixes the most common one in a tap.
  - Nothing unknown raises a note, and notes never stop you saving.
- **Log run follows the step.** **Log this step** and the step menu move a new run to the chosen step the same way: its wafers while they are still the previous step's, its recipe while it is still the previous step's.
- **What each tool takes.** **Settings → Tools → a tool → Compatibility** shows what the checks know about the tool and lets you change the sizes (your choice replaces the LNF notes' size limits), pieces, thickest wafer or stack, mask plates and materials not allowed; **Reset** undoes it.
- **No run costs yet.** They come once the LNF wiki's tool pricing is read; the store prices show on the wafer types.
- **Under the hood.** IndexedDB version 4 (the `wafers` store). The record format is still 1, so 1.4 devices keep syncing: checked against the 1.4.1 code both ways, they refuse nothing and keep every new field. New tests cover wafer specs and material classes, the LNF store list, the checks on real LNF tools (sizes, carriers, cleanliness, KOH, bonds, masks), copies and stacks, and sync of the new store; the smoke test adds store wafers to a project and fixes a check note.

## 1.4.1: Tool photos

- **Each tool's photo from the LNF wiki comes with the app.**
  - 123 of the 127 tools have one.
  - **Log run** and **Run detail** show it on the tool card; tap it to see it larger.
  - The tool's page shows it at the top.
  - The four tools without a photo on the wiki keep their category icon.
- **The app still never contacts the wiki.** The photos were fetched once, by hand, for this release, and they work offline.
- **Small download.** The photos add 2.5 MB. Later updates reuse them instead of downloading them again.
- **For maintainers:** `npm run photos` fetches photos for new tools. It stops if the wiki refuses (DECISIONS.md 110).
- The photos belong to the University of Michigan and are not covered by the app's license.

## M8: Projects in folders, runs with steps, and the alpha-test fixes

Version 1.4.0.

- **Projects follow wafers from start to finish.** They are optional: runs logged without one work as before.
  - A project has a name, goal, substrate, start date, notes, its wafers (W1, W2…, each in process, done or scrapped, with a note) and, if you like, a plan of steps, each with a tool, template and recipe.
  - **Log this step** opens Log run on the step's tool with the project, its wafers in process and the step chosen. Any run can join projects in its **Project** section, with the wafers it processed and the planned step it carries out. One run can carry wafers of several projects, and several projects can run at once.
  - A step is done when a complete run is linked to it (or you mark it done), in progress while a draft or open run is. The project page shows the progress, the next step, the plan and the **traveler**: every run its wafers went through, in order, for all wafers or one.
  - **Export the traveler** as PDF or Excel. Home lists your active projects with their next step; History filters by project; run rows show their projects; the backup, sync and every export include projects.
- **Folders and subfolders.** Projects live in folders, and folders in folders. Create, rename, move and delete folders; deleting one either moves what it holds up a level (renaming a folder whose name is already taken there) or deletes it too, with Undo. **Select** moves or deletes several projects at once. Folders sync, and the tree stays sound when two devices move folders at the same time.
- **Copy and delete projects.** **Copy project** opens a New project form with the same plan and wafer labels and nothing done yet, for the next batch. Delete has Undo and leaves the runs in place.
- **Runs with several steps.** **Add a step** for a breakthrough, an over-etch or the layers of a stack, each with its own values. The main step (★) is the one Lookup compares. A multi-step LNF recipe fills every step.
- **The Plasmatherm 790's second chamber.** A **PECVD film (right chamber)** template (seed version 3), with the wiki's seven P790 deposition recipes and their expected rates, index and stress. Every 790 recipe now names its process, so the RIE form lists only the etch recipes and the PECVD form only the deposition ones, whichever template is the tool's default.
- **Countdown timer.** **Count down** runs from the time in the form, keeps the screen on, and buzzes and beeps at zero, then counts the overtime. The alarm goes off on any screen of the app, also after a reload. **Stop** fills the main step's time with the time that passed.
- **Measurements.** **Paste values** fills the sites from the metrology tool's software or a spreadsheet: a column, a row, "site = value" pairs or CSV lines; digits inside words and dates in a header are skipped. The metrology tool starts as the one you used last for that kind of measurement (or one that measures it) and folds to one line with Change.
- **Result against an input.** Results and Tool detail plot the result against each input that varies across your runs (etch rate against ICP power), with a fitted line.
- **My tools.** Pick your tools in Settings → My tools or with ☆ on a tool's card. Tool pickers show them, and tools you used in the last two months, first, with all 127 one tap away.
- **From the alpha test:**
  - A recipe sets the material only when the form has none and the recipe's film matches one listed material; the message says when it does. Before, a recipe naming "SiO2" moved a run away from "SiO2 (thermal)", and Lookup's Same material rule missed it.
  - In the material picker, "gold" now offers **Use Au** first, not a new material; **Clear** is a link of its own.
  - Mark complete warns when the main result is missing, and says why. When only the run's time keeps the rate from being worked out, a time box appears with the results.
  - Run detail shows what the run needs next first, and an empty Results section is one short card. Open runs say what each run waits for.
  - Tool event: what happened comes first, with no preset type, and the tool folds to one line once chosen.
  - "Unsaved run" appears only for a form you changed, and names its tool.
  - Gas lines a run does not use fold behind one row of buttons.
  - Name-only recipes are listed last, with a badge; the recipe's Use button stays in reach at the bottom of the sheet.
  - The ± button appears only on fields that can be negative.
  - Results: the chart sits under the summary (beside it on a wide screen), joins only exact matches and fades runs beyond the closest few. A suggested time outside its range no longer says "range"; the subtitle says "the closest 5 of 12 runs".
  - Look up no longer says "same material" when no material is set.
  - The tool card's name opens the tool's page; Tool detail shows its charts first and its runs' key settings.
  - History: search on top, filters folded into one line that says which are set, and a sortable table on a wide screen. Forms use two columns there too.
  - Section titles in sentence case; short screen titles; the app bar shows icons only on narrow phones; "just now" instead of "now ago".
  - Lookup tuning moved under Settings → Advanced; About links to the source code.
  - Windows install steps no longer mention npm.
- **Checked before release.** Seven reviewers read every change and skeptics confirmed each problem they found; all are fixed. Three more reviewers then checked the fixes, and what they found is fixed too. Among them:
  - Saving the project editor no longer undoes step marks, a pause or a move made since the editor opened, and unsaved edits restored after such a change keep it.
  - A run's own steps stay when a one-step recipe fills it.
  - "Log this step" no longer leaves its project link in a form you only looked at.
  - The 1.3 → 1.4 upgrade no longer brings back materials you removed. Sync reads other devices' files once more, so their projects arrive.
  - Back works at once after saving or cancelling a form.
  - The traveler workbook has the conditions, substrate, mask and shared projects that the PDF shows.
  - Keyboard and screen-reader focus stays put when a form redraws.
- **Under the hood.** IndexedDB version 3 (projects and folders stores); the record format is still 1, so 1.3 and 1.4 devices keep syncing. New tests cover projects, folders, folder deletion and its Undo, run steps, measurements and pasting, the new data in backups and sync, the router's Back handling, and a smoke-test journey that logs a run into a project and files the project in a folder.

## M7: An "i" button on every field

Version 1.3.0.

- **Every field label has an "i" beside it.** Tap it to open a short note under the label, and tap again to close it.
  - **Template fields** (inputs, conditions and results) say what the setting or result is and, where there is a usual trend, what raising it tends to do. A key gets the meaning its template gives it: "pressure" is the chamber pressure on a plasma etcher, the XeF2 pressure on the Xactix and the down force on the CMP. Gases say what they do in that process: NF3 cleans the chamber of a PECVD but etches on a plasma etcher.
  - Each note ends with how Lookup treats the field, worked out from the template, for example "a difference of 5 mTorr adds 1 to the distance", "Lookup leaves it out", or the formula of a derived result. It stays right when you edit a template.
  - **Lookup tuning** (half-life, event penalty, top K): what each one does, and what raising or lowering it changes.
  - Look up's match rules, the template and field editors (weight, spread hint, must match exactly, chemistry), measurements, tool events, tool settings, sync, backup, export and the History filters have notes too.
  - The notes are general process knowledge, not recipe advice: the tool's documentation and its engineer come first.
  - Notes that only repeated a visible hint moved behind the "i": primary output, process type, role and spread hint in the template editor.
  - `test/field-help.test.mjs` checks that every field of every seeded template and every LNF gas has its own note, that a key gets its template's meaning, the Lookup line, and that every note a screen asks for exists. The smoke test checks that every visible field label on the main screens has its button, and that the button opens and closes its note.
- **No tool photos, and no automatic contact with the LNF wiki.**
  - The LNF wiki has had security problems, so the app no longer loads anything from it. A tool's card shows its category icon.
  - **?** still opens the tool's wiki page, with its photo, in your browser. If the wiki asks for a UMich login or the UMich network, you sign in there.
  - Wiki information reaches the app only through releases.
  - The photo download script is gone. The browser tests (`npm run smoke` and the desktop smoke test) cannot reach the wiki, and the smoke test fails if a page tries.

## M6: LNF recipes, tool photos, export everything, and updates that reach the phones

Version 1.2.0.

- **LNF recipes.** 599 recipes for 95 tools, read from the LNF wiki's process pages and from the sheets, documents and PDFs that its tool pages embed or link.
  - **Log run** and **Run detail** have a Recipe section above Inputs. **LNF recipes (n)** lists the tool's recipes, with search. A recipe shows its steps, which values fill the form, its results on the wiki, notes and its source.
  - **Use recipe** fills the main step (or the step you choose), names the recipe and, when the recipe names one film, sets the material. Gases the recipe does not use are cleared. **Undo** puts the form back.
  - **Look up:** **LNF recipes → Fill planned inputs** fills the inputs. Results show what the wiki says the recipe gives, next to the estimate from your runs and never mixed into it. **Log this run** keeps the recipe name.
  - **Tool detail** lists the tool's recipes; **Log run with this recipe** opens a prefilled form.
  - Recipes ship with the app: no database change, and nothing to back up or sync. A run stores the recipe name, as before.
  - Wiki pages were read from the Internet Archive's latest copies, because the wiki refused connections from off campus on 2026-10-21. The sheets and documents they embed were read live. Each recipe shows its source and date. Sources that need a UMich login are not included (see DECISIONS.md).
  - `test/recipes.test.mjs` checks the fill rules and every shipped recipe against its tool's template. The smoke test uses a recipe.
- **Tool photos and the LNF wiki in one place.**
  - Log run, Run detail and Tool detail open with the tool's card: its photo from the LNF wiki, its name, and **?**.
  - **?** gathers the tool's wiki page, its process page, the SOPs and other documents its page links, and its recipes.
  - The app ships the photos it could read (12 so far). The others load from the wiki when it is reachable, and a category icon stands in otherwise. `npm run photos`, run on the UMich network, ships the rest.
- **Export everything.** Settings → Backup and data (and a shortcut on History) exports every run, with its parameters, results and measurements, in one file (the Excel and PDF files also hold the tool events):
  - **Excel**: a workbook with all runs, one sheet per tool with named columns, the measurements and the tool events. Times are real Excel dates.
  - **CSV**: one table with a row per run.
  - **PDF**: a report to read or print, tool by tool and run by run.
  - All three are built on the device with no libraries, and share or download like the other exports.
- **A friendlier look.** A colour and icon for each tool category, on tool tiles, run rows and tool cards (both themes meet WCAG AA). A greeting on Home with this week's run count. Screens and sheets ease in, unless the system asks for reduced motion.
- **Updates reach installed apps reliably.** The app now notices a new version that started installing before the page was ready. It shows "Update available — Reload" again when it comes back to the foreground if another message pushed it away.
- **Why 1.1 never reached the phones.** Version 1.1 was built in a Synology Drive copy of the project. That copy has no `.git` folder, so 1.1 was never pushed and GitHub Pages kept serving 1.0. DEPLOY.md now has a section on what to check when the phones do not see an update.

## M5: Sync through GitHub, and the LNF equipment list

Version 1.1.0.

- **Sync** through a private GitHub repository.
  - **Settings → Sync** takes the repository, a fine-grained token and a device name, then checks them with GitHub.
  - **Sync now** sits on Home and in Settings. Each device writes one compressed file; Sync merges everyone else's: the newer edit wins, deletions carry over, nothing is wiped, and ties go to the higher device id.
  - It refuses public repositories. The token stays on the device. Files it cannot read are reported and skipped.
  - Photos stay on the device that took them, and a run says how many are elsewhere.
  - Nine sync tests run against a fake GitHub. The screens were checked in a browser against the same fake: a bad token, connecting, a first sync and a merge.
- **LNF equipment list** (seed version 2).
  - 127 tools from the LNF wiki, each with the generic template for its type and the gas lines its wiki page lists.
  - The tool picker adds category chips once there are more than 12 tools. Settings → Tools groups tools by category.
- **Materials.**
  - Every material the wiki lists as supported (106 names for 244 wiki entries), plus LiNbO3 (bulk).
  - The picker's More… sheet searches them, including the wiki's other names ("gold" finds Au), and adds new ones.
  - Materials have their own Settings page with the same search.
- **Existing installs upgrade once.** The LNF tools and materials are added, nothing is overwritten, and example tools that were never used or edited are archived.

## Installers and apps (after M4)

- **Windows.**
  - `npm run build:windows` builds `dist/LNF-Run-Log-Setup-<version>.exe` (about 1.4 MB): a per-user installer with no admin rights, Start menu and Desktop shortcuts, an Installed apps entry, update in place, and an uninstall that keeps your data unless asked.
  - The app is a native WebView2 window that bundles the app files. Its data lives in `%LOCALAPPDATA%\LNF Run Log`.
  - Verified end to end on this PC; `--smoke` repeats that check.
- **macOS.** `desktop/macos/build-macos.sh` builds a universal `LNF Run Log.app` (WKWebView, `lnfrunlog://app` scheme) and a drag-to-install DMG. Untested until its first build on a Mac.
- **Phones.** The installed web app, from the published HTTPS address.
  - **Settings → Install on your devices** shows the address as a QR code (a zero-dependency encoder, verified with OpenCV and ZXing) and the steps for iPhone (iOS 26 and 27), Android, Windows and Mac.
  - Publishing steps with GitHub Desktop are in `docs/DEPLOY.md`.
- **License.** GNU AGPL-3.0-or-later.
- **Sync design notes.** `docs/SYNC.md`.

## M4: History and data safety

- **History.** Filter by tool, template, material, status and date range (local days, inclusive), plus a keyword search over notes, recipe and tags. Filters are remembered, and `?tool=` presets the tool. Results show 50 at a time.
- **Tool detail.** Tool facts, the event timeline, a chart of each template's primary output over time with event markers, recent runs, and a "Log run" bar.
- **Backup.**
  - A JSON backup (`lnf-runlog-backup-YYYY-MM-DD.json`), photos optional with a size estimate, assembled one photo at a time.
  - Two-step export: prepare, then **Share…** (system share sheet) or **Download**.
  - CSV export: `runs.csv` with `p.*`/`r.*` columns, plus `measurements.csv` and `events.csv`, with a UTF-8 BOM and a guard against spreadsheet formula injection.
- **Merge import.** It validates the file, migrates, normalises, keeps the newer `updatedAt` per record by id, respects tombstones, never deletes, writes in one transaction, and reports added, updated, skipped and invalid counts. **Erase all data** asks you to type ERASE.
- **Storage status:** usage, quota, persisted, photo usage, and a request for persistent storage.
- **Quality checks.**
  - The browser smoke test (`npm run smoke`): load, log, measure, look up, export with a real download, offline reload, an every-control-is-labelled check, and a page-error check.
  - A WCAG AA contrast test for both themes; it found and fixed one dark-mode problem.
  - Router and helper tests.

## M3: Lookup

- **Core.** `core/similarity.js` (filters, distance, spreads, weights, ranking, extrapolation, relax counts), `core/summary.js` (sensitivity, estimates, average, headline, trend, last event, suggested time, confidence) and `core/summary-text.js` (sentences).
  - All Section 11 cases pass exactly.
  - Edge cases are covered: no candidates, a single candidate, missing fields, spread fallbacks, non-ASCII materials, siblings, events, half-life override, trends, determinism.
- **Look up.**
  - The tool → template → planned inputs flow: every field optional with Clear, prefilled from the last run.
  - Material and target thickness.
  - The Strict chemistry, Same material and Include siblings toggles.
- **Results.**
  - A summary card: headline, range, confidence with reasons, warnings, suggested time with range, sentences.
  - An output switcher.
  - Ranked matches with signed differences, d and w, and the "Exact match" and "Before last clean" flags.
  - An SVG chart of the output over time with event markers; points before an event are hollow.
  - Relax suggestions when nothing matches.
  - **Log this run**, which prefills the form and fills in the suggested time.
- The real UI reproduces the worked example. Case 4 gives 85 nm/min (exact match), 5:53 suggested, A and C before the clean; Case 3 gives 103 nm/min with the warning; Case 5 offers +3 runs.
- `docs/ALGORITHM.md` describes every rule and constant.

## M2: Capture

- **Log run.** Tool tiles (recent first, with search), then template (skipped when a tool has one), then the form.
  - The form is prefilled from the last run with the same tool and template, with a "Copied from Oct 6 run" chip and Clear.
  - It has steppers with hold-to-repeat and an mm:ss duration input.
  - Material, substrate and mask pickers list recent choices first and can add a new material.
  - It also has recipe, target thickness, context fields, optional results, camera photos (resized on the device), notes with dictation and tags.
  - An optional run timer fills the time field.
  - Save as Open, or Save complete once results exist.
  - The form autosaves to IndexedDB. If you start another form, a changed unsaved form is kept as a draft run and never lost.
- **Quick capture.** Tool, photo and note, saved as a draft run.
- **Open runs.** Drafts and open runs, oldest first with their age, plus a Resume banner for an unsaved form.
- **Run detail.** It autosaves edits and recomputes derived values.
  - Results: derived values are marked and read-only until Edit; typed values win; "Use derived" goes back.
  - Also: the measurement list, inputs, sample, conditions, photos, notes, values from removed fields, and times.
  - Actions: Measure, Mark complete or Reopen, Mark open, Duplicate as new run, Delete with Undo.
- **Measurement entry.**
  - Defaults:
    - the last-used metrology tool;
    - Pre until a pre measurement exists, then Post;
    - the same sites as the last measurement.
  - Kind, material and unit (Å and µm converted to nm on save).
  - Site presets: Center, Center + 4 edge, 5-point, 9-point and Custom.
  - One stepper per point, with Enter moving to the next.
  - Live mean, range and uniformity.
  - Saving recomputes derived outputs and reports the new primary output.
- **Tool events.** Tool, type, Major (defaulted by type), date and time (default now) and notes. Edit, and delete with Undo.
- **Derived-value core.** Tests cover Section 11 Case 6 and the edge cases (missing pre, zero, negative or missing time, empty points, zero mean, mask not etched, unit conversion, manual overrides, stale values).

## M1: Shell

- Repo skeleton, `package.json` (scripts only, no dependencies), `.gitignore`, `jsconfig.json` for editor type checks.
- `scripts/check-line-limits.mjs`: fails above 1000 lines and lists files over 600. It runs in `npm test` and CI.
- `serve.mjs`: zero-dependency static dev server with path-traversal protection and a `--lan` option.
- PWA shell:
  - `index.html` with the iOS and Android meta tags
  - the manifest
  - the versioned app-shell service worker, with an update toast that waits for the user
  - icons drawn and PNG-encoded by `scripts/make-icons.mjs`
  - `scripts/bump-version.mjs`
- Hash router with lazy view modules, an in-app back stack and guards against stale renders.
- IndexedDB layer:
  - a promise wrapper with strict-durability writes
  - schema with migrations and validators
  - stamping (ids, `updatedAt` always moving forward, author and device)
  - soft delete, settings, and autosaved form drafts
- Seed data: 12 generic "(example)" tools, 10 templates across every category, and the materials list. Fixed ids for safe merges.
- Settings:
  - name and device
  - tools: add, edit, archive, half-life override
  - template editor: fields, spec properties, reorder, derived outputs, preview, key locking
  - materials, lookup tuning with reset, theme, version and update check
- UI kit:
  - `h()` builder
  - steppers with hold-to-repeat
  - mm:ss duration input
  - segmented choices, switches, toasts with Undo, confirm dialog, bottom sheet, list rows
  - light and dark themes, both meeting AA contrast
- Tests: line limits, schema and seed, record stamping, ids, time, format, PWA shell assets, code conventions.
- Docs: `DATA-MODEL.md`, `DECISIONS.md`, `DEPLOY.md`. CI and Pages workflows.
