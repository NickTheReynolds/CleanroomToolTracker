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

## Charts, History and Tool detail (M4)

49. **Chart ranges.** Events outside the data are drawn when they fall within 10% of max(data span, 30 days) of it; farther ones are dropped. The date axis is at least 2 days wide. Tick labels add the year when the axis spans years or is not the current year.
50. **Tapping a chart.** A tap selects the nearest point within 22 units; **Open** is a separate tap, so a gloved touch never navigates by accident. The keyboard works too: arrows, Home and End select, Enter opens, Esc clears.
51. **Hollow points** mark runs that started strictly before the latest major event that is not in the future. This is the rule lookup uses for "Before last …".
52. **`#/history?tool=<id>`** shows that tool only, then rewrites the address to `#/history`, so a reload keeps the filters you change afterwards. Saved filters that no longer apply (a deleted tool, for example) are dropped.
53. **Keyword search keeps accents** (NFKC keeps "é"): "resist" does not find "Résist". It searches notes, recipe and tags only, as the spec says.
54. **Tool detail order:** facts, events (5, then Show all), one chart per template, recent runs. An active tool also gets a sticky **Log run** bar.

## Installed apps (after M4)

47. **Phones use the installed web app.** You chose this over native or store apps. Android Chrome turns it into a WebAPK; iOS makes a Home Screen web app. **Settings → Install on your devices** shows a QR code of the published HTTPS address and the steps for each platform. When the app is not running from a public HTTPS address (desktop apps, localhost), you enter the address once (`settings.publicUrl`).
48. **The desktop apps define `window.LNF_DESKTOP`** before the page loads. The web app then skips the service worker and the persistent-storage request (files are local, and updates come from the installer), and Settings → About explains how to update.
