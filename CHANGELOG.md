# Changelog

One entry per milestone (spec Section 16).

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
