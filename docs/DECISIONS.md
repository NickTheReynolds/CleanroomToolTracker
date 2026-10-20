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
