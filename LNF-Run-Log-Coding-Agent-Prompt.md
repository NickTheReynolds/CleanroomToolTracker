# LNF Run Log — Coding Agent Prompt

October 20, 2026

## 1. Role and goal

You are building **LNF Run Log**: a small, offline-first web app for logging and looking up process runs on cleanroom tools at the University of Michigan Lurie Nanofabrication Facility (LNF). One researcher uses it, possibly with a few labmates.

The app has two jobs:

1. **Capture.** Log a run on a phone in under 30 seconds while gowned and gloved: tool, recipe, parameters, and later the measured results.
2. **Lookup.** Before a run, enter the planned tool, material and parameters. Get back the most similar past runs and a plain-language summary: expected rate or thickness, spread, drift trend, sensitivity, suggested time, confidence and warnings.

The core uses no AI and no external services. Search and summary are deterministic: hard filters, a normalized distance, recency weights and simple statistics, all specified below. The same input always gives the same output.

Priorities, in order: data is never lost > fast entry with gloves > correct, explainable lookup > low maintenance > visual polish.

## 2. Domain context

A run happens on a process tool, but its results are usually measured later on a different tool, and the tools drift. Design around those three facts.

- **Process tools:** etch (RIE, ICP), deposition (PECVD, LPCVD, sputtering, e-beam evaporation, ALD), thermal (oxidation and anneal furnaces, RTA), lithography (spin coat, bake, expose, develop).
- **Metrology tools:** ellipsometer, reflectometer, stylus profilometer, SEM, four-point probe, optical microscope.
- **Runs start open.** A run is logged at the process tool and completed when measurements are added, often a pre measurement and a post measurement.
- **Typical inputs:** RF and ICP power (W), chamber pressure (mTorr), gas flows (sccm per gas), temperature (°C), time, recipe name or number, backside He, wafer size, film and substrate.
- **Typical outputs:** thickness (nm), etch rate (nm/min), deposition rate (nm/min), uniformity (%), selectivity (film:mask), refractive index, sheet resistance (Ω/sq), stress (MPa), critical dimension (µm), step height (nm), sidewall angle (°).
- **Tools drift.** Results shift after maintenance (PM), chamber cleans, seasoning, and target or source changes. These **tool events** are logged and used by lookup.
- **Shared equipment.** Seed data uses generic tool names; the user renames them to the real LNF tools. Do not invent LNF tool names, recipes or process numbers.
- **Phone conditions.** Gloves, the phone possibly in a cleanroom pouch, limited time at the tool. Typing is slow; tapping big targets and steppers is fast.

## 3. Hard constraints

These are not negotiable without asking the user first.

1. **No file over 1000 lines.** This applies to every text file in the repo: source, CSS, HTML, JSON, tests, docs and workflows. Aim for 400 lines or fewer, and split any file once it passes about 600. Enforce it with `scripts/check-line-limits.mjs`, which fails and lists offending files. Run it as part of `npm test` and CI. Exclude only `.git/` and binary files such as images.
2. **Runs on iPhone, Android, Windows, macOS and Linux from one codebase.** Build a Progressive Web App (PWA) that works in current Safari (iOS and macOS), Chrome (Android and desktop), Edge and Firefox. It must install to the home screen on iOS and Android, and as a desktop app in Chrome and Edge. No app stores.
3. **Offline-first.** After the first load, every feature works with no network: logging, lookup, charts and export. Cleanroom signal may be poor.
4. **Zero runtime dependencies and no build step.** Plain HTML, CSS and JavaScript ES modules, served as static files. No frameworks, bundlers or CDN scripts. Add a dev dependency only if it is essential, and justify it in the README; prefer none, since Node's built-in test runner is enough. This keeps maintenance near zero and the lockfile tiny.
5. **Pure core.** All search, statistics and derived-value logic lives in modules under `app/js/core/` that touch neither the DOM nor storage. They run unchanged in the browser and in Node tests.
6. **Data stays with the user.** Store it locally in IndexedDB. No analytics and no third-party requests. Optional sync (Phase 2) goes only to a server the user controls.
7. **Node 22 or newer** for local tooling (dev server, tests, optional sync server), using only Node built-ins.
8. **Relative paths and hash routing** (`#/log`, `#/lookup`), so the app works under a sub-path such as GitHub Pages at `/<repo>/`.

## 4. Architecture and tech stack

The app is a static PWA in six parts. Views, UI kit, data and core form a stack in which each calls only the parts below it; Phase 2 sync sits between views and data, and the service worker sits alongside.

1. **Views** (`app/js/views/`): one module per screen. They render DOM, handle input, and call the data and core layers. No business logic.
2. **UI kit** (`app/js/ui/`): small DOM helpers (an `h()` element builder) and reusable components. These include a numeric stepper, a field renderer driven by a template field spec, list rows, a toast, a confirm dialog and an SVG line chart.
3. **Data** (`app/js/data/`): an in-house, promise-based IndexedDB wrapper, plus repository functions per store. It also holds schema validation and migrations, seed data, export and import, and photo resizing.
4. **Core** (`app/js/core/`): pure functions for derived values, similarity, statistics, summary text, ids, time helpers and config constants.
5. **Sync** (`app/js/sync/`, Phase 2): an adapter interface and an HTTP adapter. The app works fully without it.
6. **Service worker** (`app/sw.js`): caches the app shell for offline use.

```text
Calls go down only: each layer calls only the layers below it.

  Views           one module per screen, no logic      ---  Service worker (serves app offline)
    |
  UI kit          DOM helpers, steppers, fields, chart
    |
  Sync (Phase 2)  pushes and pulls changes             -->  Sync server (Phase 2, HTTPS)
    |
  Data            IndexedDB wrapper, repo, schema      -->  IndexedDB (on the device)
    |
  Core            pure functions, imports nothing, tested in Node
```

Views reach IndexedDB only through the data layer, and the core imports nothing, so it runs unchanged in Node tests.

Rules:

- Views never touch IndexedDB directly; they go through `data/repo.js`.
- Core never imports from views, UI or data.
- IndexedDB is the single source of state. Views re-read after writes; the data is small, and simplicity beats caching.
- Put JSDoc types on every exported function and `// @ts-check` at the top of each JS file, so editors catch type errors without a build.
- Theme with CSS custom properties. Support light and dark via `prefers-color-scheme` plus a manual toggle. No CSS framework.
- Draw charts with hand-written SVG: a line chart with points and optional vertical dashed event markers. No chart library.

## 5. Project structure

Use this layout as a starting point. Add or split files as needed, but keep the layering and the line limit.

```text
lnf-runlog/
  README.md                  install, run, deploy, phone setup, backup
  package.json               scripts only: test, serve, sync-server
  serve.mjs                  zero-dependency static dev server (node:http)
  app/
    index.html               shell, meta tags, nav, <main id="view">
    manifest.webmanifest
    sw.js                    versioned app-shell cache
    version.js               APP_VERSION constant
    icons/                   icon.svg source, icon-192.png, icon-512.png,
                             maskable-512.png, apple-touch-icon.png (180)
    css/
      base.css               tokens, reset, typography, layout
      components.css         buttons, steppers, cards, lists, forms, chart
    js/
      main.js                boot, storage persist, SW registration, router
      router.js              hash routes -> view modules
      config.js              all tunable constants (Section 10)
      ui/
        dom.js               h(), clear(), on()
        fields.js            render/read a field; stepper; mm:ss input
        components.js        toast, confirm, sheet, list row, empty state
        chart.js             SVG line chart with event markers
      views/
        home.js
        log-run.js
        run-detail.js        results, measurements, photos, close run
        measurement.js
        lookup.js
        lookup-results.js
        tool-detail.js
        tool-event.js
        history.js
        settings.js
        template-editor.js
      data/
        db.js                IndexedDB open/upgrade, transaction helpers
        repo.js              CRUD and queries per store, soft delete
        schema.js            validators, migrations
        seed-tools.js        generic tools and templates (split if large)
        export-import.js     JSON backup, CSV export, merge import
        photos.js            resize and compress to JPEG
      core/
        ids.js               UUID v4 (crypto.randomUUID with fallback)
        time.js              age in days, formatting, mm:ss parsing
        derive.js            rates, uniformity, selectivity
        stats.js             weighted mean/std, least-squares fit, median
        similarity.js        filters, distance, weights, ranking
        summary.js           estimates, sensitivity, confidence, text
      sync/                  Phase 2
        adapter.js
        http-sync.js
  server/                    Phase 2
    sync-server.mjs
    store.mjs
  scripts/
    check-line-limits.mjs
    bump-version.mjs         updates version.js and the SW cache name
    make-icons.mjs           PNG icons from code using node:zlib
  test/
    fixtures.mjs             worked example (Section 11)
    derive.test.mjs
    stats.test.mjs
    similarity.test.mjs
    summary.test.mjs
    export-import.test.mjs   pure merge and CSV logic
    line-limits.test.mjs
    sync-merge.test.mjs      Phase 2
  docs/
    DATA-MODEL.md
    ALGORITHM.md
    DECISIONS.md
    DEPLOY.md
  .github/workflows/
    ci.yml                   npm test on push and pull request
    pages.yml                publish app/ to GitHub Pages
```

Icons must be real PNG files, because iOS ignores SVG touch icons. If you cannot draw them without dependencies, write `make-icons.mjs` to encode simple PNGs with `node:zlib` (a solid background with a plain glyph is fine).

## 6. Data model

There are seven IndexedDB stores, and tool templates drive every form and the lookup. Document the final model in `docs/DATA-MODEL.md`.

Every record has `id` (UUID), `createdAt` and `updatedAt` (ISO 8601 strings), `deleted` (boolean soft delete, kept as a tombstone), `deviceId` and `author`.

| Store | Key fields | Indexes |
|------|--------------------------|----------|
| `tools` | `name`, `shortName`, `category` (etch, deposition, thermal, litho, metrology, other), `kind` (process or metrology), `active`, `defaultTemplateId`, optional `halfLifeDays`, `notes` | `category` |
| `templates` | `toolId`, `name` (e.g. "Oxide etch"), `processType`, `fields[]`, `derived[]`, `primaryOutput` | `toolId` |
| `runs` | `toolId`, `templateId`, `material`, `substrate`, optional `maskMaterial`, `status` (draft, open, complete), `startedAt`, `endedAt`, `params` {key: value}, `results` {key: value}, `derivedKeys[]`, optional `targetThickness` (nm), `recipe`, `notes`, `tags[]`, `photoIds[]` | `toolId`, `[toolId, templateId]`, `startedAt`, `status` |
| `measurements` | `runId`, `metrologyToolId`, `kind` (thickness, stepHeight, cd, sheetResistance, refractiveIndex, stress, other), `phase` (pre, post), `material`, `unit`, `points[]` {site, value}, `takenAt`, `notes` | `runId` |
| `events` | `toolId`, `type` (pm, clean, seasoning, targetChange, gasChange, fault, other), `major` (default true for pm, clean, targetChange), `at`, `notes` | `[toolId, at]` |
| `photos` | `runId`, `blob` (JPEG), `width`, `height`, `caption`, `takenAt` | `runId` |
| `meta` | `schemaVersion`, `settings` (user name, device id, lookup tuning, materials list, theme, `lastExportAt`, sync config), Phase 2 `dirty` set | none |

Template fields use this spec:

| Property | Type | Meaning |
|-------|-------|------------------|
| `key` | string | Stable key used in `params` and `results` |
| `label`, `unit` | string | Shown in the form |
| `type` | number, text, select, bool, duration | Duration is stored in seconds and entered as mm:ss |
| `role` | input, output, context | Inputs drive lookup; outputs are results; context is recorded but never matched |
| `required` | bool | Default false; keep required fields to 5 or fewer per template |
| `step`, `min`, `max` | number | Stepper increment and bounds |
| `options` | `string[]` | Choices for select fields |
| `weight` | number | Distance weight; default 1, and 0 means ignored by lookup |
| `spreadHint` | number | Typical variation, used to normalize distance |
| `matchExact` | bool | Select or text field becomes a hard filter in lookup |
| `chemistry` | bool | Gas-flow field used by the strict chemistry filter |

Example template (valid JSON):

```json
{
  "name": "Oxide etch",
  "processType": "etch",
  "primaryOutput": "etchRate",
  "fields": [
    {"key": "icpPower", "label": "ICP power", "type": "number", "unit": "W",
     "role": "input", "step": 10, "spreadHint": 100, "weight": 1},
    {"key": "rfPower", "label": "RF power", "type": "number", "unit": "W",
     "role": "input", "step": 5, "spreadHint": 25, "weight": 1},
    {"key": "pressure", "label": "Pressure", "type": "number", "unit": "mTorr",
     "role": "input", "step": 1, "spreadHint": 5, "weight": 1},
    {"key": "chf3", "label": "CHF3", "type": "number", "unit": "sccm",
     "role": "input", "step": 1, "spreadHint": 20, "weight": 1, "chemistry": true},
    {"key": "o2", "label": "O2", "type": "number", "unit": "sccm",
     "role": "input", "step": 1, "spreadHint": 5, "weight": 1, "chemistry": true},
    {"key": "time", "label": "Time", "type": "duration", "unit": "s",
     "role": "input", "weight": 0},
    {"key": "chuckTemp", "label": "Chuck temp", "type": "number", "unit": "°C",
     "role": "context"},
    {"key": "etchRate", "label": "Etch rate", "type": "number", "unit": "nm/min",
     "role": "output"},
    {"key": "uniformity", "label": "Uniformity", "type": "number", "unit": "%",
     "role": "output"}
  ],
  "derived": [
    {"output": "etchRate", "fn": "etchRate", "timeField": "time"},
    {"output": "uniformity", "fn": "uniformity", "phase": "post"}
  ]
}
```

Seed generic templates for each category: ICP/RIE etch, PECVD, sputtering, e-beam evaporation, ALD, furnace oxidation, spin coat, ellipsometer and profilometer. Also seed a short materials list: Si, SiO2 (thermal), SiO2 (PECVD), Si3N4 (LPCVD), SiNx (PECVD), Al, Au, Cr, Ti, positive resist and negative resist. Store a `schemaVersion` in `meta`, and keep ordered migrations in `schema.js`.

## 7. Screens and UX

Every screen must work with gloved thumbs, one hand, and no typing beyond short notes.

Global rules:

- Touch targets at least 48 × 48 px; primary buttons at least 56 px tall; at least 8 px between targets.
- Base font 17 px. Inputs use 16 px or larger, which stops iOS from zooming on focus.
- Number inputs use `inputmode="decimal"` and have − / + steppers driven by the field's `step`. Holding a stepper repeats.
- No swipe-only or hover-only actions. Destructive actions ask for confirmation, soft-delete, and offer Undo in a 5-second toast.
- Primary actions sit in a sticky bottom bar. Respect `env(safe-area-inset-*)` and use `dvh` instead of `vh`.
- Readable in dark mode and bright light; never rely on colour alone.
- Autosave every in-progress form to IndexedDB on each change, so nothing is lost when the phone locks or the tab is killed.
- Home screen interactive in under 1 second on a mid-range phone after install.

Screens:

1. **Home.** Four big buttons: Log run, Look up, Open runs (with a count badge) and Tool event. Below them, the 5 most recent runs. A backup banner appears when there has been no export for 14 days, or ever. An Install button appears when the browser offers `beforeinstallprompt`; on iOS, show a one-time hint to use Share → Add to Home Screen.
2. **Log run.**
    1. Pick a tool from big tiles, recently used first, with a search box.
    2. Pick a template; skip this step if the tool has only one.
    3. Fill the form, prefilled from the last non-deleted run with the same tool and template. Show a "Copied from Oct 6 run" chip with a Clear action.
    4. The form shows template inputs, material and substrate pickers (recent first), recipe, optional target thickness and notes. Phone keyboard dictation works for notes.
    5. Add photos with `<input type="file" accept="image/*" capture="environment">`.
    6. An optional run timer: Start records `startedAt` and shows elapsed time; Stop fills the template's duration field.
    7. Save as Open (the default), or Complete if outputs are entered now.
3. **Quick capture.** Tool, photo and note only, saved as a draft to fill in later.
4. **Open runs.** Draft and open runs, oldest first, showing tool, recipe and age. Tap to open the run detail.
5. **Run detail.** Editable inputs; outputs, manual or derived (derived ones marked); a measurement list with Add measurement; photos; notes. Actions: Mark complete, Duplicate as new run, Delete.
6. **Measurement entry.** Pick the metrology tool, kind, phase (pre or post), the material measured and the unit. Choose a site preset (Center; Center + 4 edge; 5-point; 9-point; custom), with each point as a stepper field. Show mean, range and uniformity live. Saving recomputes the run's derived outputs.
7. **Look up.** The same tool → template → form flow as Log run, prefilled from the last run, with every field optional and an optional target thickness. Three toggles: Strict chemistry (on), Same material (on), Include sibling tools of the same category (off). Then a Find similar runs button.
8. **Lookup results.**
    - A summary card at the top: headline estimate, range, confidence badge, warnings, trend, suggested time.
    - The ranked matches below it: top 5, with Show more. Each row shows date, distance, weight and primary output, plus highlighted signed differences from the query ("ICP +50 W"). Flag "Exact match" and "Before last clean" where they apply.
    - A chart of the primary output against date for matching runs, with event markers.
    - A Log this run button that opens Log run prefilled with the query.
9. **Tool detail.** Tool info, event timeline, runs list, and a chart per template of its primary output over time, with event markers.
10. **Tool event.** Tool picker, type, a major toggle, date and time (default now), notes.
11. **History.** Filter by tool, template, material, status and date range. Keyword search across notes, recipe and tags. Tap a row to open the run detail.
12. **Settings.**
    - User name and device name.
    - Tools: add, edit, archive.
    - Templates: a template editor to add, remove and reorder fields, edit field spec properties, and preview the form.
    - Materials list.
    - Lookup tuning: half-life, event penalty and top-K, with Reset to defaults.
    - Export and import.
    - Storage: usage from `navigator.storage.estimate()` and whether storage is persisted.
    - Theme, app version and Check for update.

## 8. Derived values

Derived outputs come from a fixed set of built-in functions in `core/derive.js`, never from user-written formulas. A template's `derived` entries map an output key to one of these functions.

| Function | Formula | Inputs | Unit |
|------|---------|----------|---|
| `etchRate` | (pre − post) / (time / 60) | Pre and post mean thickness of the run's `material`; time in seconds | nm/min |
| `depRate` | (post − pre) / (time / 60), with pre = 0 when absent | Same as `etchRate` | nm/min |
| `removed` | pre − post | Pre and post mean thickness | nm |
| `deposited` | post − pre | Pre and post mean thickness | nm |
| `uniformity` | (max − min) / (2 × mean) × 100 | Points of one measurement (post by default) | % |
| `uniformityStd` | sample std / mean × 100 | Points of one measurement | % |
| `selectivity` | rate of `material` / rate of `maskMaterial` | Etch rates of each, from their own pre and post measurements | ratio |

Rules:

- A measurement's mean is the arithmetic mean of its points.
- Store thickness in nm. Convert Å (÷ 10) and µm (× 1000) on entry. Keep one small unit table; do not build a general unit system.
- If any input is missing, the output is absent, never 0. The UI says what is missing, for example "needs pre measurement".
- Recompute whenever a measurement or input changes. Store the values in `run.results` and list their keys in `run.derivedKeys`. A manually entered output overrides the derived value and removes its key from `derivedKeys`.
- Round only for display (3 significant figures by default). Store full precision.
- Reject time ≤ 0 and empty point lists with a clear message instead of producing NaN or Infinity.

These are the test values: pre 1000 nm, post 575 nm and 300 s give 85 nm/min. Points 412, 398 and 405 nm give a mean of 405 nm and uniformity of 1.728%.

## 9. Lookup algorithm

Lookup filters past runs, scores each by a weighted sum of normalized parameter differences, ranks by that distance, and weights by recency and tool events. Implement it in `core/similarity.js` as pure functions, and describe it in `docs/ALGORITHM.md` in words that match the code.

**Input:** a query with `toolId`, `templateId`, `material`, `params` (any subset of the template's input fields), optional `targetThickness`, the options `strictChemistry`, `sameMaterial` and `includeSiblings`, and `now`. Candidates are non-deleted runs with status complete that have at least one output.

**Step 1: hard filters.** A candidate must pass all of these:

- Same `toolId`. With `includeSiblings`, any tool of the same `category` instead.
- Same `templateId`. With `includeSiblings`, any template of the same `processType` instead.
- Same `material`, when `sameMaterial` is on.
- Equal values for every `matchExact` field that the query sets.
- With `strictChemistry`: the set of chemistry fields with a value above 0 is the same in query and run. A chemistry field absent from a run counts as 0 here.

**Step 2: distance.** For every input field the query sets with weight above 0, add one term:

- Numeric field: weight × |q − r| / s.
- Select, text or bool field (not `matchExact`): 0 when equal, otherwise weight × `CATEGORICAL_PENALTY`. Compare text trimmed and case-insensitive.
- Field set in the query but missing from the run: weight × `MISSING_PENALTY`.

The spread s is the field's `spreadHint` if set. Otherwise it is the sample standard deviation of that field across the filtered candidates, if at least 4 have it and it is above 0. Otherwise it is max(|q| × 0.1, 1e-9).

The distance is the sum of the terms, not their mean; the worked example depends on this. Duration fields default to weight 0, because time changes thickness, not rate.

```text
d = sum over k of  w_k * |q_k - r_k| / s_k
```

**Step 3: weights.** Each match gets a weight used by the summary statistics:

```text
w = exp(-d) * 0.5^(ageDays / halfLifeDays) * eventFactor

eventFactor = EVENT_PENALTY  if a major event happened since the run
            = 1              otherwise
```

- `ageDays` = (now − `run.startedAt`) / 86 400 000 ms.
- `halfLifeDays` is the tool's override, else the setting, default 30.
- "A major event since the run" means a major tool event for the run's tool with `run.startedAt` < `event.at` ≤ now.

**Step 4: rank.** Sort by distance, smallest first; break ties by the more recent `startedAt`. Show the top `TOP_K` (5), with the rest behind Show more. Each match carries `d`, `w`, its three weight factors, an `eventSince` flag, and a `diffs` list of {key, q, r, delta} for fields where q and r differ.

**Step 5: extrapolation.** For each numeric query input with weight above 0, warn if q lies outside the min–max of that field across the filtered candidates. Example: "ICP power 500 W is outside your range (400–450 W)."

**No matches.** If no candidate passes the filters, return no matches. Also return how many runs each relaxed option would add (Strict chemistry off, Same material off, Include siblings on), so the UI can suggest one.

## 10. Summary generation

The summary is arithmetic on the ranked matches, turned into short template sentences in `core/summary.js`. It covers the template's primary output by default, and any other output on request.

**Sensitivity.** Look at pairs of filtered candidates that differ in exactly one numeric input k. That means |Δk| > `SENS_MIN_DELTA` × s_k, every other numeric input with weight above 0 differs by at most `SENS_MAX_OTHER` × s, and categorical inputs are equal. A field absent from both runs counts as equal. The sensitivity for k is the median of Δoutput / Δk over those pairs. Report it with its pair count.

**Closest-run estimate.** Take the top-ranked match c that has the output. Find the inputs where q and c differ by more than `DIFF_THRESHOLD` × s. If every one of them has a sensitivity, the adjusted estimate is:

```text
estimate = y_c + sum over k of  sens_k * (q_k - c_k)
```

If nothing differs, the estimate is c's value. If some differing input has no sensitivity, show c's value alone, labeled "closest run".

**Similar-runs average.** The weighted mean and weighted standard deviation over the top K using w, plus the min and max.

**Headline.** The adjusted estimate when available; otherwise the weighted mean.

**Trend.** Use filtered runs with d ≤ `TREND_MAX_DISTANCE` and age ≤ `TREND_WINDOW_DAYS`. If there are at least `TREND_MIN_N`, fit a least-squares line of output against date and report slope × 7 per week. Call it "stable" if |slope × span in days| is less than one standard deviation of those outputs; otherwise "rising" or "falling". Separately, whatever the run count, report the latest major event and the number of runs since it.

**Suggested time.** If a target thickness T is given and the headline rate R > 0, time = T / R minutes. Give a range from T / max and T / min of the top-K rates. Display mm:ss.

**Confidence.**

- **Low** if only one match has the output, the best d exceeds `CONF_LOW_MIN_D`, or any extrapolation warning exists.
- **High** if at least `CONF_HIGH_MIN_MATCHES` matches have d ≤ `CONF_HIGH_MAX_D`, the closest is at most `CONF_HIGH_MAX_AGE_DAYS` old with no major event since it, and there is no extrapolation.
- **Medium** otherwise.

**Sentences.** Generate a sentence only when its numbers exist, with no filler. Use the process type for the verb: etch for etch, deposit for deposition, run otherwise. Examples:

- "3 similar runs. Closest: Oct 6 (exact match), 85 nm/min."
- "Similar runs average 88.4 nm/min (71–94)."
- "Rate rises ~0.18 nm/min per W of ICP power (1 pair)."
- "For 500 nm, etch ~5.9 min (5:53)."
- "Chamber clean on Oct 10; 1 run since."
- "ICP power 500 W is outside your range (400–450 W); the estimate is extrapolated."

Put every tunable constant in `app/js/config.js`. Settings can override the first three.

| Constant | Default | Used in |
|----------|-----|----------|
| `HALF_LIFE_DAYS` | 30 | Recency weight |
| `EVENT_PENALTY` | 0.5 | Weight after a major event |
| `TOP_K` | 5 | Matches shown and averaged |
| `CATEGORICAL_PENALTY` | 1.0 | Distance for unequal select or text |
| `MISSING_PENALTY` | 1.0 | Distance for a field missing from a run |
| `DIFF_THRESHOLD` | 0.1 | Spreads before a difference counts |
| `SENS_MIN_DELTA` | 0.25 | Spreads the varied input must change |
| `SENS_MAX_OTHER` | 0.1 | Spreads other inputs may change |
| `TREND_MAX_DISTANCE` | 1.0 | Runs eligible for the trend |
| `TREND_WINDOW_DAYS` | 90 | Trend window |
| `TREND_MIN_N` | 4 | Runs needed for a trend |
| `CONF_HIGH_MIN_MATCHES` | 3 | High confidence |
| `CONF_HIGH_MAX_D` | 0.5 | High confidence |
| `CONF_HIGH_MAX_AGE_DAYS` | 60 | High confidence |
| `CONF_LOW_MIN_D` | 1.5 | Low confidence |
| `BACKUP_REMINDER_DAYS` | 14 | Home backup banner |
| `PHOTO_MAX_EDGE` | 1600 px | Photo resize |
| `PHOTO_QUALITY` | 0.8 | JPEG quality |

## 11. Worked example as acceptance tests

Put this fixture in `test/fixtures.mjs`; the six cases below must pass exactly, within the stated tolerances.

**Setup.** One ICP tool and the "Oxide etch" template from Section 6. All runs are complete, with material SiO2 and `o2` = 0. Use `now` = 2026-10-20T12:00:00Z and `halfLifeDays` = 30, with default constants and no tool events unless a case adds one.

| Run | ICP power (W) | Pressure (mTorr) | CHF3 (sccm) | Etch rate (nm/min) | startedAt | Age (days) |
|--|----|----|----|----|--------|---|
| A | 400 | 10 | 50 | 85 | 2026-10-06T12:00:00Z | 14 |
| B | 450 | 10 | 50 | 94 | 2026-10-13T12:00:00Z | 7 |
| C | 400 | 15 | 40 | 71 | 2026-07-22T12:00:00Z | 90 |

**Case 1: exact match.** The query is ICP 400, pressure 10, CHF3 50, with a 500 nm target.

- Distances: A 0, B 0.5, C 1.5. Order A, B, C.
- Age factors ≈ 0.7236, 0.8507, 0.1250; weights ≈ 0.7236, 0.5160, 0.0279 (± 0.0005).
- Weighted mean ≈ 88.36 nm/min (± 0.05); min 71, max 94.
- ICP power sensitivity ≈ 0.18 nm/min per W from 1 pair (A, B). No sensitivity for pressure or CHF3, because A and C differ in two inputs.
- Headline 85 nm/min (exact match). Suggested time 5.882 min, shown as 5:53.
- No extrapolation. No trend (3 runs < 4). Confidence medium, because only 2 matches have d ≤ 0.5.

**Case 2: between runs.** The query is ICP 425, pressure 10, CHF3 50.

- Distances: A 0.25, B 0.25, C 1.75. B ranks first on the recency tie-break.
- Headline = 94 + 0.18 × (425 − 450) = 89.5 nm/min.
- No extrapolation. Confidence medium.

**Case 3: extrapolation.** The query is ICP 500, pressure 10, CHF3 50.

- Distances: A 1.0, B 0.5, C 2.5. B is closest.
- Headline = 94 + 0.18 × 50 = 103 nm/min.
- Warning: ICP power 500 W is outside 400–450 W. Confidence low.

**Case 4: tool event.** Case 1's query, plus a major chamber clean at 2026-10-10T12:00:00Z.

- A and C are flagged "Before last clean"; B is not. Weight of A ≈ 0.3618.
- Weighted mean ≈ 89.99 nm/min (± 0.05).
- The summary includes "Chamber clean on Oct 10; 1 run since."

**Case 5: no matches.** Case 1's query with O2 = 10 sccm and strict chemistry on.

- Zero matches. The relax suggestion says turning off Strict chemistry would add 3 runs.

**Case 6: derived values.** These are the values from Section 8.

- Pre 1000 nm, post 575 nm and 300 s give an etch rate of 85 nm/min.
- Points 412, 398 and 405 nm give a mean of 405 nm and uniformity of 1.728% (± 0.001).

## 12. Storage, backup, export and import

Browser storage can be cleared, so regular exports are the safety net and the app must make them effortless.

- **Database.** Name the IndexedDB database `lnf-runlog` and version it. Call `navigator.storage.persist()` on first run, and show the result in Settings.
- **iOS caveat.** Safari may clear site data for web apps that have not been used for a while. Home-screen apps are treated more favorably, but the policy changes between iOS versions. Check current WebKit storage behavior, and never rely on it.
- **JSON backup.** One file named `lnf-runlog-backup-YYYY-MM-DD.json` containing `{format: "lnf-runlog", version, exportedAt, tools, templates, runs, measurements, events, settings}`. Leave out device-specific settings. Photos are optional behind an "Include photos" checkbox, stored as base64, with a size warning.
- **Saving the file.** Use the Web Share API with files when available, so the phone's share sheet can send it to Files, Drive or email. Otherwise use a download link.
- **CSV export** for Excel or Sheets: `runs.csv` with one column per param and result key across templates (prefixed `p.` and `r.`), plus `measurements.csv` and `events.csv`.
- **Import.** Accept JSON only and validate it with `schema.js`. Merge by id: an incoming record wins only if its `updatedAt` is newer, and tombstones are respected. Report counts of added, updated and skipped records.
- **Never wipe on import.** A separate Erase all data action in Settings requires typing a confirmation word.
- **Reminder.** Show a Home banner when there has been no export for `BACKUP_REMINDER_DAYS`, or ever.
- **Photos.** Resize to `PHOTO_MAX_EDGE` on the long edge as JPEG at `PHOTO_QUALITY`, using a canvas. Store the blob in `photos`, and show storage used in Settings.

## 13. Optional Phase 2: sync server

Build sync only after Phase 1 is complete and the user asks for it; Phase 1 must not depend on it. Sync keeps the same data on phone and PC, and can optionally share it with a few labmates.

**Client.** `sync/adapter.js` defines `push(records)` and `pull(cursor)`, where pull returns `{records, cursor}`; `http-sync.js` implements them. Settings get a server URL, a shared token, Sync now, and a status line (last sync, pending count). Sync automatically on app open and after each save, when online.

**Change tracking.** Every write sets `updatedAt` and adds the record to the `dirty` set in `meta`. A sync pushes dirty records, then pulls.

**Server.** `server/sync-server.mjs` uses Node built-ins only.

- `POST /api/push` with `{records: [{store, record}]}`, and `GET /api/pull?since=<seq>`.
- The server gives each stored change an increasing `seq`. Pull returns changes with seq above `since`, plus the new cursor. This avoids depending on device clocks for the cursor.
- Auth: `Authorization: Bearer <token>`, compared with `crypto.timingSafeEqual`. The token comes from an environment variable.
- CORS allows only the configured app origin.
- Storage: one append-only JSONL file per store in a data directory, an in-memory index, and compaction at startup.
- It also serves `app/` statically, so a PC user can run everything with one command.

**Conflicts.** Last writer wins per record by `updatedAt`; on a tie, the higher `deviceId` string wins. Deletes are tombstones and are never physically removed.

**Photos** are not synced in v1, because they are large. A run shows "photo on another device" instead.

**Hosting.** Phones need HTTPS to a reachable host. In `docs/DEPLOY.md`, describe running it on an always-on machine behind HTTPS, on a small hosted VM or container, or over a private network tunnel. Check current pricing and terms for any provider you name, and keep vendors out of the code.

**Tests.** Merge logic (last writer wins, ties, tombstones), push and pull with cursors, and auth rejection.

## 14. Running and deploying on each platform

One static HTTPS URL serves every platform. GitHub Pages is the default host because it is free, uses HTTPS, and needs no server upkeep.

| Where | How |
|------|----------------|
| Development (any OS) | `node serve.mjs`, then open `http://localhost:8080`. Service workers work on localhost. |
| Hosting | `pages.yml` publishes `app/` to GitHub Pages. Any static HTTPS host also works. |
| iPhone | Open the URL in Safari, then Share → Add to Home Screen. It opens full-screen and works offline. |
| Android | Open the URL in Chrome, then Install app (or menu → Add to Home screen). |
| Windows, macOS, Linux | Open in Chrome or Edge and use the install icon in the address bar, or use it as a website in any browser. On macOS Safari, File → Add to Dock. |
| Phone testing against the dev server | `http://<pc-ip>:8080` on the same Wi-Fi works for quick checks, but without HTTPS there is no service worker or offline mode. Use the hosted URL for real use. |

Install menu wording changes between OS versions, so verify it before writing the README.

**Updates.** The service worker uses a versioned cache. When a new version is waiting, show an "Update available — Reload" toast; never reload in the middle of data entry. `scripts/bump-version.mjs` updates `version.js` and the cache name together.

**iOS and Android requirements in `index.html`:**

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- `apple-touch-icon` at 180 × 180 PNG, plus 192 and 512 PNG icons and a maskable icon in the manifest
- `theme-color`, `mobile-web-app-capable`, `apple-mobile-web-app-capable` and `apple-mobile-web-app-status-bar-style`
- Inputs at 16 px or larger, safe-area padding, and `100dvh` layouts

## 15. Testing and quality gates

A milestone is done only when `npm test` passes, which runs `node --test test/` and the line-limit check.

- **Core tests.** Unit tests for every core module, including all Section 11 cases. Cover edge cases too: zero candidates, a single candidate, missing fields, zero spread, zero or negative time, a missing pre measurement, and non-ASCII material names.
- **Data tests.** Test the pure parts of the data layer in Node: merge, validation and CSV flattening. Keep the IndexedDB code thin.
- **Browser smoke test.** If your environment can run a headless browser, load the app, log a run, add a measurement, run a lookup, export, and reload offline. If it cannot, say so and rely on the manual checklist.
- **Manual phone checklist** in the README, for iPhone Safari and Android Chrome: install; still works in airplane mode; log a run with thumbs only; take a camera photo; enter a measurement; look up; export through the share sheet; import on a desktop; the update flow.
- **CI.** `ci.yml` runs `npm test` on current Node LTS for every push and pull request.
- **Accessibility.** Every input has a label, focus is visible, buttons are `<button>` elements, and contrast meets WCAG AA.
- **Type checking.** `// @ts-check` in every JS file. The README may describe an optional `npx tsc --noEmit --allowJs --checkJs` run, but CI does not require it, to stay dependency-free.

## 16. Milestones

Build in five milestones, in order, and commit after each one with a short summary. Milestone 5 starts only when the user asks.

1. **M1: Shell.** Repo skeleton, line-limit script, dev server, and the PWA shell (manifest, icons, service worker, offline). Also the router, IndexedDB with schema and migrations, seed tools, templates and materials, and Settings for managing them.
    - Done when the app installs on a phone, opens offline, shows the seed data, and tests pass.
2. **M2: Capture.** Log run (prefill, steppers, timer, photo, quick capture, draft autosave), Open runs, Run detail, measurement entry with live mean and uniformity, derived outputs, and Tool events.
    - Done when a run can be logged and closed with measurements on a phone in under 30 seconds of taps (not counting process time), and the derived-value tests pass.
3. **M3: Lookup.** Similarity, summary, the results screen, the trend chart with event markers, relax suggestions, and Log this run.
    - Done when all Section 11 cases pass and the results screen shows them correctly.
4. **M4: History and data safety.** History search, Tool detail charts, JSON backup and merge import, CSV export, the share sheet, the backup reminder, storage status, and the update toast.
    - Done when exporting on a phone and importing on a desktop reproduces the data exactly.
5. **M5 (optional): Sync**, as in Section 13.
    - Done when two devices converge after offline edits on both, and the sync tests pass.

## 17. Working rules and how to report back

Read this whole document before writing code, and treat Sections 3, 9, 10 and 11 as the contract.

- If something is ambiguous or contradictory, ask once with specific options. Otherwise pick the simplest option that fits, and record it in `docs/DECISIONS.md`.
- Do not add dependencies, frameworks or external services without asking.
- Check the line limit as you go, not at the end. Split by responsibility, never by cutting a function in half.
- Do not invent LNF tool names, recipes or process numbers. Seed data is generic and labeled as an example.
- Keep `docs/ALGORITHM.md` in step with the code, including every constant.
- At the end of each milestone, report: what was built; the test summary; any files over 600 lines; decisions made; known issues; and what the user should try on a phone.
- The final deliverable is a working repo with all tests passing and a README covering setup on every platform.
