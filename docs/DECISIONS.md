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

20. **Number fields use `type="text" inputmode="decimal"`, not `type="number"`.** This avoids locale and spinner quirks. Decimal commas are accepted. A ± button appears when the field allows negatives (no `min`, or `min` < 0), because the iOS decimal pad has no minus key.

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
