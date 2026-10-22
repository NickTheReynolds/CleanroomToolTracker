# Decisions

These are choices the spec left open, or where it needed a small adjustment. Each follows the spec's rule: pick the simplest option that fits, and record it here.

## Tooling

1. **Repo root.** The spec's `lnf-runlog/` tree lives at the root of this folder (`CleanroomToolTracker/`); the folder name does not matter to the app.

2. **`npm test` runs `node --test` with no path.**
   - Since Node 21, `--test` arguments are glob patterns. Node 22 and 24 therefore try to run a bare directory such as `test/` as a module and fail.
   - With no argument, Node's default patterns find `test/*.test.mjs` on Node 20, 22 and 24.
   - They also load `test/fixtures.mjs` as a "test" with no cases, which is harmless.

3. **Node version.**
   - Tooling targets Node 22+ (`engines`), and CI runs the current LTS.
   - The code also runs on Node 20 because it avoids 22-only APIs. The development PC had Node 20.14, which is end-of-life.
   - The browser smoke test needs a global `WebSocket` (Node 22+, or Node 20 with `--experimental-websocket`).

4. **Core may import `config.js`.** The spec places all constants in `app/js/config.js` and requires a core that imports nothing from views, UI or data. `config.js` is pure data, so core modules import it for defaults. Every core function also accepts a config object, so tests and Settings can override values.

5. **Deploy stamps the build.**
   - `scripts/bump-version.mjs` changes `version.js`, the service worker cache name and `package.json` together.
   - As a safety net, the Pages workflow also writes the short commit hash into the cache name and `APP_BUILD`.
   - Every deploy therefore reaches installed apps, even if a version bump was forgotten.

6. **Dev server binds to 127.0.0.1 by default.** `--lan` exposes it to phones on the same Wi-Fi. This avoids opening a firewall prompt and the LAN when it is not needed.

6a. **The line-limit check skips directories excluded by `.gitignore`.** These are build outputs and caches such as `build/`, `dist/` and `.cache/`: they are not part of the repository, and a desktop build copies the whole app into them.

7. **Browser smoke test.** `scripts/smoke-browser.mjs` drives headless Chrome or Edge through the DevTools protocol, using Node built-ins only. It is not part of `npm test`, because CI and other machines may have no browser.

## Data

8. **Seed records use fixed UUIDs and an old timestamp** (`2026-01-01`). Two devices that both seeded the examples merge without duplicates, and any real edit wins.

9. **`author` and `deviceId`.** `author` is the creator and is kept on edits. `deviceId` is the last device to write the record, which Phase 2 needs for tie-breaks.

10. **`updatedAt` always moves forward.** It is at least 1 ms after the previous value, so two quick saves never tie.

11. **Form autosave lives in `meta` as `draft:<form>`.** It does not create half-filled run records. A Log run form gets its run id when it opens, so photos taken before Save are stored immediately. Discarding the form removes those photos physically; they never belonged to a saved run.

12. **Prefill source.** The prefill is the latest non-deleted run with the same tool and template that has at least one parameter. Bare quick captures are skipped.

13. **Settings in backups.** Backups carry only the materials list and lookup tuning. Import unions the materials and leaves local tuning unchanged. Name, device, theme and export time stay per device.

14. **Text comparison.** Material and text matching use Unicode NFKC, trimmed, collapsed spaces and lower case, so "SiO₂" equals "SiO2".

## Derived values

15. **Which measurement counts.**
    - A measurement with a blank material counts as the run's material.
    - When several match the same phase, kind and material, the latest by `takenAt` wins.

16. **`deposited` uses pre = 0 when there is no pre measurement,** like `depRate`. A new film usually has no pre measurement.

17. **`selectivity` is the ratio of thickness removed** (film ÷ mask). Both etch for the same time, so this equals the rate ratio and needs no time value. A mask that did not thin gives no value ("mask was not etched").

18. **Uniformity divides by |mean|** so a negative mean (stress) cannot give a negative percentage. For positive thicknesses it is exactly the spec formula.

## UI

19. **Durations are entered in two number boxes (minutes : seconds)** with − / + steppers. Phone number pads have no colon key. Steppers move by the field's `step` (default 10 s).

20. **Number fields use `type="text" inputmode="decimal"`, not `type="number"`.** This avoids locale and spinner quirks. Decimal commas are accepted. A ± button appears when the value can be negative, because the iOS decimal pad has no minus key: when `min` is below 0, or when there is no `min` and the field holds a temperature in °C, a stress, a voltage, a focus, an offset or a bias. Until 1.4 every field without a `min` had one, so powers, pressures and flows showed a ± they never need.

21. **Back button.** It returns to the previous in-app page when there is one, otherwise to the screen's parent. After a save the form's history entry is replaced, so Back does not reopen a finished form.

22. **Backup banner on Home.** It appears once at least one run exists and there has been no export for 14 days, or ever. A fresh install with only example data shows no nag.

23. **Template field keys lock once runs use them.** Renaming the key would hide those runs' values. Deleting a field keeps the values on the runs.

24. **A tool's kind follows its category.** Choosing the Metrology category sets kind to metrology. Moving away from Metrology sets it back to process.

25. **The theme is mirrored to `localStorage`**, a per-device convenience, so a forced light or dark theme applies before first paint. IndexedDB holds the actual setting.

## Capture (M2)

26. **One Log run form at a time.** Starting a different form (another tool, Duplicate, or Log this run) moves the current one aside:
    - if it was changed, it is saved as a **draft run** in Open runs;
    - if it was untouched, it is dropped.

    Nothing typed is ever silently discarded, and the app never blocks with a question.

27. **Quick capture** gives the draft the tool's default template, or its only template. A draft without one asks for a template on Run detail.

28. **Run detail layout.**
    - The sticky bar holds the frequent actions: **Measure** and **Mark complete** (or **Reopen**).
    - **Duplicate** and **Delete** sit at the bottom of the page, away from gloved thumbs.
    - Marking a run complete without any result asks for confirmation, because lookup ignores such runs.

29. **Derived results are read-only until Edit.** This prevents accidental overrides. A typed value shows a "manual" badge, plus **Use derived (x)** when a derived value exists.

30. **Measurement defaults** save taps:
    - the last-used metrology tool;
    - phase **Pre** until the run has a pre measurement, then **Post**;
    - the kind, and the same sites, as the run's latest measurement (so post points line up with pre points);
    - the run's material.

    Stepper increments follow the unit (1 nm, 10 Å, 0.01 µm). Empty points are skipped, and at least one point is required.

31. **Site names.** "Center + 4 edge" uses N/E/S/W edge sites and "5-point" uses C/N/E/S/W; the spec names both presets but does not define their positions. "9-point" adds four diagonal edge sites.

## Lookup screens (M3)

32. **The lookup form shows only input fields.** Context fields are never matched, so they are not asked for. Every field has a Clear button, and the form is prefilled from the last run with the same tool and template.

33. **Log this run.**
    - It copies the last run's context and sample details, then overlays the query's inputs, material and target.
    - When the results suggest a time, it fills the template's time field with it and says so in a toast.

34. **Output choice.** When a template has several outputs, the results screen can switch which one is summarised. The primary output is the default.

35. **Toasts.** At most two show at once, and each disappears after 5 s (8 s for errors) unless it carries an action that must stay, such as "Update available — Reload".

## Lookup engine (M3)

36. **Candidates also need a parseable `startedAt`**; otherwise ages and ranking would be undefined. Deleted tools and templates count as not found. Strings of only spaces count as unset.
37. **Hard filters.**
    - The exact-match and strict-chemistry filters apply only to fields with role `input`, whatever their weight.
    - Exact match applies only to choice, text and yes/no fields.
    - Strict chemistry compares the union of the chemistry keys of the query's template and the run's template; an absent or non-numeric value counts as 0.
38. **Distances** that agree to 9 decimal places rank as a tie, so floating-point noise never decides the order. A negative weight counts as 0.
39. **The latest event.** When two events share a time, the one with the larger id counts as the latest.
40. **Wording.**
    - The average sentence appears only when 2 or more runs have the output.
    - A sensitivity of exactly 0 reads "… does not change with X (n pairs)".
    - Unexplained differences are listed together ("Pressure and CHF3 differ …").

## Backup, import and CSV (M4)

41. **Import order and ties.** Incoming records are migrated, then normalised, then validated. On an equal `updatedAt`, or an unreadable local timestamp, the local record is kept: import is conservative. Phase 2 sync will use the spec's `deviceId` tie-break instead, so devices converge. If one file holds the same id twice, the newest copy is used.
42. **What an import touches.** The merged materials list is saved in the same transaction as the records. Lookup tuning is never imported.
43. **Photos in backups.**
    - Deleted photos are exported without their image.
    - An incoming photo record without image data keeps the stored image.
    - Invalid base64 makes the record invalid.
    - If Safari rejects Blobs, the image is stored as an ArrayBuffer, the same fallback `addPhoto` uses.
    - The backup file is assembled one photo at a time, so no single giant string is built.
44. **`lastExportAt`** is set only by sharing or downloading the JSON backup. CSV export does not count, because CSV cannot be imported back.
45. **CSV details.**
    - Rows are oldest first, and dates stay ISO 8601 UTC.
    - `p.` and `r.` columns are sorted case-insensitively.
    - Measurements of deleted runs are left out, and a blank measurement material shows the run's material.
    - CSV download is one button per file, because browsers block several downloads from one tap. Share sends all three files at once.
46. **Android Chrome refuses to share `.json` files,** so on Android the backup offers Download only.

## Installed apps (after M4)

47. **Phones use the installed web app.** You chose this over native or store apps. Android Chrome turns it into a WebAPK; iOS makes a Home Screen web app. **Settings → Install on your devices** shows a QR code of the published HTTPS address and the steps for each platform. When the app is not running from a public HTTPS address (desktop apps, localhost), you enter the address once (`settings.publicUrl`).
48. **The desktop apps define `window.LNF_DESKTOP`** before the page loads. The web app then skips the service worker and the persistent-storage request (files are local, and updates come from the installer), and Settings → About explains how to update.

## Charts, History and Tool detail (M4)

49. **Chart ranges.** Events outside the data are drawn when they fall within 10% of max(data span, 30 days) of it; farther ones are dropped. The date axis is at least 2 days wide. Tick labels add the year when the axis spans years or is not the current year.
50. **Tapping a chart.** A tap selects the nearest point within 22 units; **Open** is a separate tap, so a gloved touch never navigates by accident. The keyboard works too: arrows, Home and End select, Enter opens, Esc clears.
51. **Hollow points** mark runs that started strictly before the latest major event that is not in the future. This is the rule lookup uses for "Before last …".
52. **`#/history?tool=<id>`** shows that tool only, then rewrites the address to `#/history`, so a reload keeps the filters you change afterwards. Saved filters that no longer apply (a deleted tool, for example) are dropped.
53. **Keyword search keeps accents** (NFKC keeps "é"): "resist" does not find "Résist". It searches notes, recipe and tags only, as the spec says.
54. **Tool detail order:** the tool card, facts, LNF recipes when the tool has any (5, then Show all), events (5, then Show all), one chart per template, recent runs. An active tool also gets a sticky **Log run** bar.

## License

55. **GNU AGPL v3 or later.** You wanted it shareable but not co-opted. The AGPL is a strong copyleft:
    - anyone may use, share and change the app;
    - copies keep the copyright notice;
    - changed versions must be marked and released under the same license with their source;
    - its network clause also covers running a changed version as a hosted service, which matters for a web app.

    Alternatives considered:
    - **GPL v3** lacks the network clause.
    - **MPL** and permissive licenses (MIT, Apache) allow closed forks.
    - **Non-commercial licenses** (such as PolyForm Noncommercial) forbid commercial use outright but are not open source, and they would also block benign uses. Switching later is possible while you are the only copyright holder.

    The full text in `LICENSE` is the official gnu.org file, unmodified. At 661 lines it is the one file over the 600-line split guideline, and legal text cannot be split. Settings → About shows the copyright, the license summary, a link to the source once `SOURCE_URL` in `config.js` is set, and a note that the project is not affiliated with the University of Michigan or the LNF.

## Sync (M5, GitHub variant)

56. **Sync uses a private GitHub repository, at your request.** It replaces the spec's self-hosted push/pull server for now, because not everyone has the Synology app and phones reach GitHub anywhere. A private repository in your own account or organization is a reasonable reading of "a server the user controls". A server or lab-PC hub can come later with the same merge rules.
57. **Snapshot per device, not a change log.** Each device writes its whole state, minus photos, to one file of its own, and reads everyone else's. This needs no cursor and no coordination, can never cause a write conflict between devices, and lets the repository history serve as a backup. At lab scale the compressed files stay small.
58. **Ties go to the higher `deviceId` in sync** (the spec's rule), so devices converge. Backup import keeps the local copy on a tie (decision 41).
59. **Safety rules.**
    - A public repository is refused.
    - The token is stored only on the device and never exported.
    - Unreadable or newer-format files are reported and skipped, and the sync still writes this device's file.
    - Derived results are recomputed for runs touched by a merge.
60. **Photos do not sync** (spec v1). A run with photos taken elsewhere says how many are on another device.

## LNF equipment and materials (seed version 2)

61. **Real LNF tool names, at your request.** The spec said not to invent LNF tool names. You asked for every tool on the LNF wiki, so the seed lists them as the wiki names them: 127 tools from Category:Equipment, read on 2026-10-20. The 8 decommissioned tools are left out; the 10 the wiki marks as down or unclear are kept. Nothing is invented: each tool gets the generic template for its type (ICP etch, LPCVD, sputter and so on) with the gas lines its wiki page lists, and no recipes or process numbers.
62. **Ids come from the names.** Each tool and template id is a SHA-256 of a fixed prefix and the tool name, formatted as a v4 UUID, so devices that seed separately merge cleanly (as in decision 8). `data/seed-lnf.js` was generated once and is now edited by hand.
63. **Existing databases upgrade once** (`meta.seedVersion` 1 → 2). The upgrade adds the LNF tools and templates that are missing and never overwrites a record. It merges the materials and archives example tools that were never used or edited. Used or renamed examples stay.
64. **One entry per material.** The wiki lists materials on several pages and spells them differently ("Gold", "Au", "Gold (all)").
    - The seed merges each material under one formula-style name.
    - Films keep their process where it changes the film, because etch rates differ: "SiO2 (thermal)", "SiO2 (PECVD)", "SiO2 (LTO)".
    - The example list's names come first, in its old order.
    - The result is 106 materials covering all 244 wiki entries, plus "LiNbO3 (bulk)" as you asked. The approved-materials sheet lists lithium niobate for 41 tool pages.
    - Restricted materials (KOH-exposed samples, spin-on dopants) are left out.
65. **Material search also uses the wiki's names.** The picker's More… sheet and Settings → Materials match the start of each word of the name and of the wiki's other names for it. So "gold" finds Au and "nitride" finds every nitride, while "si" does not match "Positive resist". The same box adds a new material.
66. **Materials have their own Settings page,** because the list grew from 11 to about 100.

## LNF recipes (version 1.2)

67. **Recipes from the LNF wiki, at your request.** Decision 61 left recipes out; you then asked for every recipe the wiki documents. The app now ships 599 recipes for 95 tools. Nothing is invented: each recipe gives its source, the date of the copy it was read from, and a link.
68. **Where they come from.**
    - On 2026-10-21 the wiki refused connections from off campus, so its pages were read from the Internet Archive's newest copies (most from 2024 to 2026).
    - The Google Sheets, Docs and PDFs that those pages embed or link were read live the same day, so their data is current. For example, the GSI PECVD characterization tab was last updated in August 2026.
    - The import was a one-time job. Fix or add a recipe by editing `data/lnf-recipes-*.js`, as for `seed-lnf.js`.
69. **What is missing.** Some recipes could not be read in full.
    - The Internet Archive never saved some recipe pages: LAM 9400's Bell_Poly, mnf_parylene_slow_iso, LNF_GaAs_HBr, Moly_HBr_O2 and BARC_1, and STS APS DGRIE's SiC_1 and Si3N4_R27. Their process pages name them, so the app lists them by name, without parameters, with a link to the wiki.
    - Some documents the wiki links need a UMich login, or were deleted. Examples are the Oxford ALD and AE evaporator process sheets, the Cooke and SJ-20 standard-process documents, and a Plasmatherm 790 process sheet. Recipes that only they describe are missing or listed by name only.
    - Of the 599 recipes, 99 have a name but no parameters. 32 tools have no recipes on the wiki at all: mostly microscopes, probe stations, storage, and benches without a named process.
70. **Reference data, not records.** Recipes live in the app's code, not in the database. So there is no schema change, nothing to back up or sync, and every device has the same list. A run still stores only the recipe name, so History search and CSV work as before. A wiki recipe cannot be edited in the app; type your own name, or change values after using one.
71. **What Use fills.**
    - The main step by default (the step you choose, for multi-step recipes).
    - A value goes only into a field with the same key, the role being filled and a suitable type. Values are converted into the template's units on import.
    - Gas fields the step does not use are cleared, because a recipe names its whole chemistry.
    - The material is set when the recipe names exactly one film.
    - A gas the step lists without one number ("30-0 sccm (ramped)") is used, so it stays as it is.
    - Everything else stays. Undo takes back only what the recipe changed, and goes away when the form does. Values with no field are shown for reference only.
    - A recipe whose sources disagree or are unclear carries a short "Check this one" note.
72. **The Recipe field moved** from Sample to its own section above Inputs, in Log run and Run detail, because choosing a recipe sets the inputs.
73. **Lookup.** "Fill planned inputs" fills input fields only, since context is never matched. Log this run keeps the recipe name. When the query names an LNF recipe, Results shows what the wiki says it gives, separately from the estimate: the estimate uses only your own runs.
74. **How the recipes were read.** For each tool, one agent read its sources and wrote the recipes in the app's format, converting values into the template's units. A second, independent agent checked every value against its source and looked for missed recipes. `test/recipes.test.mjs` checks that every value fits its tool's template. Treat a recipe as a starting point and check it against the tool: the wiki's numbers can be older than the tool's current state.

## Updates (version 1.2)

75. **The update prompt no longer misses a new version.** Phones check for a new version as the app starts, often before the page listens for it. The app now also watches a worker that is already installing when it registers. It shows "Update available — Reload" again when the app returns to the foreground if another message pushed it away. Before, the prompt could wait until the app was restarted.
76. **Why 1.1 did not reach the phones.** It was never pushed: the Synology Drive copy it was built in has no `.git` folder (Synology does not sync names that start with a dot), and GitHub Pages kept serving 1.0. DEPLOY.md explains how to check the published version and how to make such a copy a repository.

## Tool photos, the wiki sheet and export (version 1.2)

77. **No tool photos: the app never contacts the LNF wiki by itself.**
    - Version 1.2 showed each tool's photo from the LNF wiki. It shipped 12, and loaded the rest from the wiki when the wiki was reachable.
    - Version 1.3 removes the photos. The LNF wiki has had security problems, and the app should add nothing to its traffic. A tool's card shows its category icon instead.
    - Version 1.4.1 ships the photos inside the app instead (decision 110). The app still never contacts the wiki.
    - To see a photo, tap **?**: the tool's wiki page opens in the browser, where UMich's own sign-in or network rules apply.
    - Wiki information (tools, recipes, links) reaches the app only through releases. It is read by hand, with the project owner's agreement.
    - The browser tests cannot reach the wiki: `scripts/cdp.mjs` makes its host unresolvable, and the smoke test fails if a page even tries.
78. **"?" is the tool's single entry point to the wiki.** It lists the tool page, the process page, the documents the page links (SOPs, overviews, process sheets) and the tool's recipes in the app. Links open in the browser. The sheet says the wiki may ask for a UMich login or the UMich network, and that the app itself never contacts the wiki.
79. **Export everything writes one file, in the format you choose.** Excel is the default because it keeps one sheet per tool with named columns and real dates, plus the tool events. CSV is one table with a row per run, since a CSV file can hold only one table; tool events stay in events.csv. PDF is a report for reading and printing, with each tool's events, not for analysis.
80. **Times.** The Excel, PDF and CSV `date` column use local time, for people. The CSV also keeps the ISO 8601 UTC start and end (as runs.csv does, decision 45), for machines.
81. **No libraries for Excel or PDF.**
    - The workbook is a zip of stored (uncompressed) SpreadsheetML parts with inline strings, which every spreadsheet program reads.
    - The PDF uses the 14 standard fonts, which PDF readers always have, so nothing is embedded. That limits text to WinAnsi; other characters are spelled out or shown as "?".
    - Both writers are pure core modules with tests. Excel opened a sample workbook without repairs.
82. **Visual changes stay within the existing design.**
    - Each tool category has a colour and an icon, used on tool tiles, run rows and tool cards. The colours meet AA contrast on every surface in both themes (tested).
    - Home greets you with this week's run count.
    - Screens, sheets and dialogs ease in over about 0.2 s, and buttons respond to a press. All motion is off when the system asks for reduced motion.

## Info buttons (version 1.3)

83. **One "i" button per field, opening a note in place.**
    - Not a tooltip, because phones have no hover. Not a sheet either: the note sits under the field it explains, and the form stays usable while it is open.
    - The button is a disclosure, with `aria-expanded` and `aria-controls`, named "About <field>".
    - It sits beside the label, never inside it, so tapping the label still focuses the input. On a switch it sits beside the switch, because a button cannot hold another button.
    - Its 36 px target overlaps the row's spacing, so rows do not get taller.
    - A choice with no label of its own gets the button beside its section title: an event's tool, the metrology tool, the measurement points.
    - A few inputs have no button on purpose. The Active switch in a tool's settings: its hint says it all. The quick-capture and measurement notes and the tool search box: their purpose is plain. The template choice on a run that has none, and the word typed to confirm Erase all data.
84. **Process notes give general trends, hedged, and no settings.**
    - A note says what a setting is and what raising it usually does. It does not say what to set: there is no recipe-specific advice, as asked.
    - Some keys mean different things in different templates: pressure, temperature, time, cycles, dose, source, current, power and force. For these, the template's other fields pick the note: a CMP template has a slurry field, an XeF2 template a pulse field, a sputter template a target. Its process type is the fallback.
    - Units and names are free text, so they decide only where nothing else can: the LPCVD and laser-writer notes, and a plasma cleaner's when its fields are ambiguous. So a unit changed in the field editor, or a renamed template, keeps the right note (tested).
    - A gas note fits where the gas is used. On the LNF PECVD tools, NF3, CF4 and C2F6 clean the chamber; on an etcher they etch.
85. **The Lookup line is worked out, not written.**
    - The line comes from the field's spec: role, weight, spread hint, must match exactly, chemistry, and the formula of a derived output.
    - So it stays right for templates people edit, and for fields the app has no note for.
86. **Notes that only repeated a visible hint moved behind the "i".**
    - Hints that carry a rule or a number stay visible, such as "Default 30. Allowed 1–3650." or the key's rules.
    - Hints that only described the field went behind the "i": primary output, process type, role and spread hint in the template editor.

## Projects and folders (version 1.4)

87. **Projects are optional, and a run joins one from its own side.**
    - A run lists its projects in `run.projects` as `{projectId, waferIds, stepId}` links. A run without links is exactly the run it always was, so logging single runs is unchanged.
    - One run can carry wafers of several projects (a furnace load, a wet bench), and several projects can be active at once.
    - The project record holds only the project: its wafers, its plan and its notes. Linking from the run means a project never has to be rewritten when a run is logged on another device, so sync conflicts stay per record.
88. **A plan's progress is worked out from the runs.**
    - A step is done when a complete run is linked to it, in progress when a draft or open run is, to do otherwise. A step can also be marked done without a run (work done outside the app) or skipped. Progress counts done steps out of those not skipped.
    - Wafers and steps that a run names cannot be removed, only finished, scrapped or skipped, so the traveler never loses a step or a wafer it shows.
    - "Log this step" opens Log run on the step's tool and template, with the project, its wafers in process and the step already chosen, and the step's recipe name. Nothing is saved until the person saves: leaving the form leaves no draft run behind.
89. **The traveler is the project's linked runs, oldest first.** For one wafer it is the runs that name that wafer: its path through the process. It exports as PDF (to read or file) and Excel (to analyse), built on the device like the other exports.
90. **Folders are records of their own, in a store that syncs.**
    - An empty folder can exist, and renaming a folder is one write. Folders hold folders through `parentId`; a project names its folder through `folderId`.
    - Sync can leave a folder whose parent was deleted, or two folders inside each other (moved on two devices at once). The tree puts the first at the top level and, in a loop, the folder with the lowest id; every device draws the same tree, and nothing is rewritten until the person moves something.
    - Deleting a folder asks what to do with what it holds: move it up to the parent, or delete it too. Both are soft deletes with Undo, written in one transaction. A folder moved up whose name the parent already has becomes "Name (from Deleted)", so two folders in one place never share a name; Undo restores the name too. The plan is worked out from the repaired tree by a pure function (`folderDeletePlan`), which the tests cover.
    - A folder move is checked against the folders as stored now, not the screen's list, so a folder never goes into itself or a folder inside it, even from a second tab.
    - Select on the Projects screen moves or deletes several projects at once, so filing old projects into a new folder takes a few taps.
91. **Copy project opens a filled-in New project form instead of saving a copy at once.** The copy needs its own name, and Cancel leaves nothing behind. It keeps the goal, substrate, notes, folder, wafer labels and plan, with new ids; every wafer is in process again, no step is done and no run comes along (runs belong to the batch that went through them).
92. **Versions.** `DB_VERSION` 2 adds the projects store and 3 the folders store, so a database that already opened a development build with projects still gets folders. `SCHEMA_VERSION` stays 1: everything new only adds to the format with defaults, an older app keeps fields it does not know and skips stores it does not know, and a sync file without projects or folders still merges. Devices on 1.3 and 1.4 keep syncing; the 1.3 device simply does not show projects.
    - Sync remembers which device files it has read (`seen`) and now also which stores that covered (`seenStores`). A device updated from 1.3 had read other devices' files without their projects and folders, so it reads every file once more; after that, unchanged files are skipped as before.
    - The seed upgrade from version 2 to 3 adds the missing template only. Only the step from seed 1 merges the LNF materials, so materials a person removed stay removed.

## Runs with steps, the second chamber and recipes (version 1.4)

93. **A run's main step lives in `params`.** A multi-step run lists its steps, and the main step's values are the run's ordinary `params`. Lookup, the derived results, History, the CSV and every export keep reading `params` unchanged, and a one-step run is `steps: []`. Lookup compares the main step only: the other steps are recorded, not matched.
94. **Using a multi-step LNF recipe in a run form fills every step**, and the step picked in the recipe sheet becomes the main step. In Look up it fills the chosen step only, since Lookup compares one step.
95. **The Plasmatherm 790 gets a second template: PECVD film (right chamber).** Seed version 3 adds it with a fixed id, so devices that upgrade separately merge it, and a device where it was deleted keeps it deleted. The RIE template is not touched, because devices with different copies of it would otherwise diverge. Every 790 recipe names its process (`"etch"` or `"deposition"`), so each form lists its own recipes and "Log run with this recipe" opens the matching template. Which template is the tool's default does not matter: a person can change it. A recipe that names no process shows with every template of its tool, as before 1.4.
96. **A recipe sets the material only when that is unambiguous, and only when the form has none.** The alpha test found a recipe naming "SiO2" moving a run away from "SiO2 (thermal)", so Lookup's Same material rule then missed the runs it was meant to find. Now the film must match a listed material exactly, or be the only listed material of that name with a process in brackets ("SiNx" → "SiNx (PECVD)"). The message after Use says when it set one. Recipes with no values sort last with the badge "Name only".

## The alpha test (version 1.4)

97. **My tools.** With 127 LNF tools, every picker opened on a long list. The person's tools (chosen in Settings → My tools, or with ☆ on a tool's card) and the tools used in the last 60 days now come first, with every tool behind "All tools (n)" and search covering all of them. The choice belongs to the device, like the theme: it does not sync, since a phone and a shared lab PC may well differ.
98. **Screens say what comes next.** Run detail puts what the run needs first: a draft its inputs, an open run its measurements, a complete run its results. Open runs say what each run waits for ("needs post measurement", "needs time"). When only the run's time keeps a rate from being worked out, the time box appears with the results. Mark complete warns when the main result is missing, and says why.
99. **Forms ask only what they need.**
    - A template with four or more gas lines shows the gases in use, with the rest one tap away.
    - Pickers fold to the choice once made (substrate, an event's tool, the metrology tool), with Change beside it.
    - A tool event has no preset type: a wrong preset ("Clean", major) was easy to save by accident and changes Lookup. What happened comes first, then the tool.
    - A measurement's metrology tool starts as the tool used last for that kind, else one whose LNF type measures it (a reflectometer for thickness, the Flexus for stress), and follows the kind until the person picks one.
    - Paste values reads a column, a row, "site = value" pairs or CSV lines. On a line with spaces, tabs or semicolons the comma is a decimal comma. On a line with only commas it separates values, except that a line holding one decimal number ("1002,5") keeps its comma when every comma line of the paste is like that (a column of decimal-comma values). This is decided once per paste: when any comma line is not one number (a CSV header or row), commas separate on every comma-only line, so "1,1002" under "Site,Thickness" is site 1 and 1002. Digits inside a word or a date ("SiO2", "W-1", "2026-10-21") are not values. When every line holds two numbers, the first is the site.
100. **"Resume" only for a form someone changed.** A Log run form opened and left untouched (it only holds the last run's values) no longer shows "Unsaved run" banners, and is never kept as a draft run. The banner names the tool.
101. **The countdown timer keeps the phone awake.** It counts down the time already in the form, then buzzes, beeps and counts the overtime. The Screen Wake Lock keeps a phone in its pouch from locking mid-run, and the clock is computed from the stored start, so it survives a locked phone or a reload anyway. Stop fills the main step's time with the time that actually passed.
    - The alarm lives outside the Log run screen: one per app, for the Log run form's countdown. So it goes off, and the screen stays awake, while the person looks at the tool's page or the project, and the message at zero offers to open the form. After a reload the app arms it again from the stored form. When it goes off it checks that the form still runs that countdown (it may have been saved, discarded or set aside).
    - A reloaded page may sound and vibrate only after a tap, so the next tap anywhere unlocks them, and the card says so. On an iPhone the beeps ask to play in silent mode where Safari allows it; Safari cannot vibrate.
102. **Wider screens use the width.** History becomes a table that sorts by any column, Results puts the summary beside its chart, and forms use two columns, at 900 px and up. Phones are unchanged.
103. **Smaller visual fixes.** Section titles are in sentence case rather than capitals. On a narrow phone the app bar shows its three icons without labels (screen readers still hear them), and screen titles are short, with the tool named on the page. Lookup tuning moved under Settings → Advanced, since the defaults suit most tools. About links to the source code, as the AGPL asks.

## Checked before release (version 1.4)

104. **A multi-agent review before shipping.** Seven reviewers (data and sync, core logic, run forms, project screens, Lookup and the UI kit, security and offline, docs and tests) read every change, a skeptic tried to refute each finding, and a critic looked for what they missed. Every confirmed problem was fixed before the release. The decisions below came out of it.
105. **The project editor saves on top of the stored project.** The form edits the name, goal, dates, substrate, status, folder, wafers and the plan. The marks on each step (done, skipped) are set on the project page, so Save keeps the stored ones. If the project changed since the editor opened (on this device or another), Save asks first. Unsaved edits made from an older version are still restored, with a note that the project changed since, but the status, end date and folder come from the stored project unless the person changed them in the form, so restoring cannot undo a pause, a finish or a move made since.
106. **Back after Save or Cancel goes back.** A form that returns to the page it was opened from (an edit, a measurement, a delete) now goes back in history instead of replacing its entry with a second copy of that page. Before, the first press of Back seemed to do nothing. The router keeps the in-app history (`track`, `canGoBack`), so this holds for every screen.
107. **"Log this step" joins a project only for the run it starts.** The link is stored with the person's first change, so a form opened and left untouched keeps no project. The address loses `?project=&step=` once applied, so Back, Forward or a reload cannot bring back a link the person removed. A form already in the project moves to the step asked for.
108. **A recipe keeps the run's own steps unless it brings its own.** A recipe with one step (or none) fills the main step and leaves the run's other steps alone; a multi-step recipe replaces them, and Undo restores them. Lookup's "Log this run" takes the steps of the Lookup's LNF recipe, or the last run's when it used the same recipe, never another recipe's.
109. **Sheets close when the screen changes.** A sheet (a dialog from the bottom) closes when the app moves to another screen, for example after "Log this step" in a plan step's sheet, so it never stays over a screen it does not belong to.

## Tool photos (version 1.4.1)

110. **Tool photos come with the app, at the project owner's request.** This brings photos back without undoing decision 77, because the app still never contacts the wiki.
    - **How they were fetched.** `npm run photos` (`scripts/tool-photos.mjs`) asked the live wiki once, by hand, with the owner's agreement, on 2026-10-22. It made one request a second: 6 API queries and 117 downloads, and the wiki refused none.
    - **Which photo.** The wiki names most tool photos after the scheduler number (`10020.jpg`). A page without one counts only if it shows a single photo; icons never count.
    - **What ships.** 123 of the 127 tools have a photo (117 files, 2.5 MB). They are shrunk to 480 px JPEGs in `app/img/tools/`. Four tools have none on the wiki.
    - **If the wiki refuses.** The script stops at the first refusal: no retries, and no other routes such as the Internet Archive.
    - **Certificates.** The wiki's server leaves out its intermediate certificate. The script is given that public certificate (`NODE_EXTRA_CA_CERTS`); certificate checks stay on.
    - **Where they show.** The tool card on Log run and Run detail shows a thumbnail that opens larger. The tool's page shows the photo at the top.
    - **Credit and license.** Each larger view says "Photo: LNF wiki, © University of Michigan." The photos are not covered by the app's license.
    - **Updates.** Every photo's name carries a hash of its bytes, so a changed photo gets a new name. A service worker update copies the photos from the previous version's cache instead of downloading 2.5 MB again.
