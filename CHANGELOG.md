# Changelog

One entry per milestone (spec Section 16).

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
