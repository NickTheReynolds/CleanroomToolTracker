# LNF Run Log

LNF Run Log is an offline-first web app for logging and looking up process runs on cleanroom tools at the Lurie Nanofabrication Facility. It is built for one researcher, possibly with a few labmates. It runs from one codebase on iPhone, Android, Windows, macOS and Linux, and installs to the home screen like an app. There are no app stores, no accounts and no tracking.

The app has two jobs:

- **Capture.** Log a run on a phone in under 30 seconds while gowned and gloved: tool, recipe, parameters, and later the measured results.
- **Lookup.** Before a run, enter the planned tool, material and parameters. The app returns the most similar past runs and a plain-language estimate: expected rate or thickness, spread, drift trend, sensitivity, suggested time, confidence and warnings.

Lookup uses no AI and no external services. The same input always gives the same output (see [docs/ALGORITHM.md](docs/ALGORITHM.md)). Your data stays in the browser storage of each device, so back it up (see [Backups](#backups-and-moving-data)).

## What's in the app

| Screen | What it does |
|---|---|
| Home | Log run, Look up, Open runs (with a count) and Tool event; the latest runs; a backup reminder; install help. |
| Log run | Tool → template → a form prefilled from your last run with that tool, under the tool's photo; **?** opens its LNF wiki pages and documents. **LNF recipes** fill the form from one of the tool's wiki recipes. Steppers, material chips, run timer, camera photos, notes (dictation works). Save open, or complete if you already have results. |
| Quick capture | Tool, photo and note only, saved as a draft to fill in later. |
| Open runs | Drafts and open runs, oldest first. |
| Run detail | Results (derived from measurements, or typed in), measurements, inputs, photos and notes. Mark complete, duplicate, delete (with Undo). |
| Measurement | Metrology tool, pre/post, kind, material and unit, and a site preset (Center, Center + 4 edge, 5-point, 9-point, Custom). Shows live mean, range and uniformity. |
| Look up | Planned inputs (all optional, or filled from an LNF recipe), material, target thickness, and the strict chemistry, same material and sibling tools toggles. |
| Results | Estimate with range and confidence, warnings, trend, suggested time, ranked matches with differences ("ICP power +50 W"), a chart with tool events, what the wiki says an LNF recipe gives, and Log this run. |
| Tool detail | Tool info, the tool's LNF recipes, event timeline, runs, and a chart of each template's main result over time. |
| Tool event | PM, clean, seasoning, target or gas change, fault. Major events reduce the weight of earlier runs. |
| History | Filter by tool, template, material, status and dates; search notes, recipe and tags. Export everything from here too. |
| Settings | Your name and device, tools and the template editor, materials, lookup tuning, backup, export everything (Excel, CSV or PDF), import, sync, storage, theme, version and updates. |
| Install on your devices | The app's address as a QR code for phones, and install steps for iPhone, Android, Windows and Mac. |

**Tools and materials.** The app starts with the LNF equipment list from the LNF wiki: 127 tools, grouped as etch, deposition, thermal, lithography, metrology and other, with search in every tool picker. It also has every material the wiki lists as supported, plus bulk lithium niobate, and the material picker searches them ("gold" finds Au). Each tool has a generic template for its type, with the gas lines its wiki page lists, and the recipes the wiki documents for it: 599 recipes for 95 tools. Run screens show the tool's photo from the wiki, and **?** gathers its wiki page, process page, SOPs and recipes in one place. Adjust a template to how you use the tool, and archive tools you never use, in **Settings → Tools and templates**.

## Quick start (development)

You need Node.js 22 or newer, and only for the dev server and the tests. The app itself is plain HTML, CSS and JavaScript ES modules, with no dependencies and no build step.

```text
npm test                 # line-limit check + all unit tests (node --test)
npm run serve            # http://localhost:8080 (service worker and offline mode work on localhost)
npm run serve -- --lan   # also http://<pc-ip>:8080 for a phone on the same Wi-Fi
npm run smoke            # optional: headless-browser end-to-end check (needs Chrome or Edge)
npm run build:windows    # Windows installer -> dist/ (on Windows; downloads the WebView2 SDK once)
npm run build:macos      # macOS app and .dmg -> dist/ (on a Mac with Xcode Command Line Tools)
```

Over plain `http://<pc-ip>` a phone gets no service worker and no offline mode. That is fine for quick layout checks; use the HTTPS address for real use.

## Deploy

GitHub Pages is the default host: it is free for public repositories and served over HTTPS.

1. Push this folder to a GitHub repository.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. CI runs the tests, then publishes `app/` to `https://<user>.github.io/<repo>/`.

Any static HTTPS host also works: upload the contents of `app/`. Releases, updates, other hosts and the optional sync server are covered in [docs/DEPLOY.md](docs/DEPLOY.md).

## Install on your devices

| Device | App | How you get it |
|---|---|---|
| iPhone, iPad | Home Screen web app: full screen, offline, its own icon | From the published HTTPS address (steps below) |
| Android | Installed web app (a WebAPK, listed under Settings → Apps) | From the published HTTPS address (steps below) |
| Windows | Desktop app with an installer (per-user, no administrator rights) | `npm run build:windows` builds `dist/LNF-Run-Log-Setup-<version>.exe`; see [docs/DESKTOP.md](docs/DESKTOP.md) |
| macOS | Desktop app (`.app` in a `.dmg`), drag to Applications. **Untested** until its first build on a Mac. | `bash desktop/macos/build-macos.sh` (or `npm run build:macos`), run **on a Mac** with the Xcode Command Line Tools; see [docs/DESKTOP-MACOS.md](docs/DESKTOP-MACOS.md) |

**Phones in three steps:**

1. Publish the app once. GitHub Pages is free; [docs/DEPLOY.md](docs/DEPLOY.md) walks through it with GitHub Desktop.
2. On a computer running the app, open **Settings → Install on your devices** and enter the published address once. The screen shows a QR code.
3. Scan the QR code with each phone and follow that phone's steps.

The desktop apps bundle the app files and need no hosting. Every installed copy keeps its own data, separate from browsers and from your other devices, so install before you start logging. Keep them in step with **Settings → Sync** (see [Sync](#sync-between-devices-and-labmates)), or move data once with a backup file.

Installing from a browser instead, using the published address:

| Device | How to install (checked October 2026; menu wording changes between versions) |
|---|---|
| iPhone or iPad (iOS 26 and 27) | Open the address in **Safari**. Tap the **Page Menu** button (iOS 27) or the **More (…)** button (iOS 26), then **Share**. If your tabs are set to Bottom or Top, tap **Share** directly. Scroll down, tap **Add to Home Screen**, keep **Open as Web App** on, and tap **Add**. |
| Android | Open the address in **Chrome**, tap **⋮ → Install and create shortcut → Install**. |
| Windows, macOS or Linux with Chrome | Click the install icon at the right of the address bar, or **⋮ → Cast, save, and share → Install page as app…** |
| Windows or macOS with Edge | Click the **App available** icon in the address bar, or **… → More tools → Apps → Install this site as an app**. |
| macOS with Safari (Sonoma or later) | **File → Add to Dock**. |
| Firefox | It works as a normal website. On Windows, Firefox 143 and later can pin it with the **Add tab to taskbar** button. |

The installed app opens full screen and works in airplane mode. To check, open it once online and then go offline.

## Using it in the cleanroom

- **Big targets.** Every control works with gloved thumbs. Hold **−** or **+** to repeat. Numbers accept a decimal comma. The **±** button flips the sign, since phone number pads have no minus key.
- **Nothing is lost.** Every form saves itself as you go. If the phone locks or the tab is closed, the next visit resumes it. Photos are stored the moment you take them.
- **Fast logging.** Log run copies your last run with the same tool and template, so usually you only change what differs.
- **LNF recipes.** On Log run, tap **LNF recipes** to pick one of the tool's wiki recipes. It fills that recipe's parameters, clears the gases it does not use and names the recipe; **Undo** puts your values back. Each recipe shows its source and date: check it against the tool before you rely on it.
- **Run timer.** The timer is optional: **Start** records the start time, and **Stop** fills the template's time field.
- **Derived results.** Add a **pre** and a **post** measurement, and the run computes etch or deposition rate, thickness change, uniformity and selectivity. A value you type yourself always wins.
- **Tool events.** Log PMs, chamber cleans and target changes. Lookup flags runs from before the last major event and gives them less weight.

## Backups and moving data

Browser storage can be cleared: by the system when space runs low, by clearing site data, or by Safari's rules for sites you have not used for a while. Exports are your safety net. The Home screen reminds you when you have not exported for 14 days.

**Settings → Backup, import and storage:**

- **Export backup** writes one JSON file, `lnf-runlog-backup-YYYY-MM-DD.json`, with all tools, templates, runs, measurements, events, the materials list and lookup tuning.
  - Photos are optional ("Include photos"), and the screen shows how much they add.
  - Where the browser supports sharing files (iPhone and iPad, Android, and Chrome or Edge on Windows and macOS), **Share…** opens the system share sheet so you can save to Files or Drive, or email it. **Download** works everywhere.
- **Export everything** writes one file with every run, its parameters, results and measurements (the Excel and PDF files also hold the tool events). Choose **Excel** (a workbook: all runs, one sheet per tool with named columns, measurements, tool events), **CSV** (one table, a row per run) or **PDF** (a report to read or print). History has a shortcut to it.
- **Export CSV** writes `runs.csv` (one column per parameter `p.*` and result `r.*`), `measurements.csv` and `events.csv` for Excel or Sheets.
- **Import backup** merges a JSON backup into this device.
  - It never deletes anything: each record is matched by id, the newer version wins, and deletions travel as tombstones.
  - Afterwards it shows how many records were added, updated and skipped.
  - To move to a new phone or a desktop, export on one device and import on the other.
- **Erase all data** is separate, and you must type `ERASE` to confirm.
- **Storage** shows the space used and whether the browser granted persistent storage. On iPhone, installed Home Screen apps get more durable storage than Safari tabs.

## Sync between devices and labmates

**Settings → Sync** keeps runs the same on every device, and across a group, through a **private GitHub repository**. It works on any phone with internet; no other app or server is needed.

**How it behaves:**
- Each device keeps one file in the repository (`lnf-runlog-sync/devices/<device>.lnfsync`, compressed).
- **Sync now** merges everyone else's file into this device, then writes this device's file. The newer edit wins, deletions carry over, and nothing is ever wiped.
- Every sync is a commit, so the repository history doubles as a versioned backup.
- Photos stay on the device that took them. A run shows how many are elsewhere.

**Set it up once:**
1. On github.com, create a **private** repository (for example `lnf-runlog-data`).
2. Under **Settings → Developer settings → Fine-grained tokens**, make a token with access to **only that repository** and **Contents: Read and write**.
3. On each device, open **Settings → Sync**, enter the repository and the token, give the device a name, and tap **Save and check**.

For labmates, either share that token privately, or put the repository in a free GitHub **organization** so each person makes their own token. GitHub's fine-grained tokens can't reach a personal repository you're only a collaborator on.

**Good to know:**
- The token stays on the device and never goes into backups.
- Sync refuses public repositories.
- The data in the repository is not encrypted, so share access only with people you trust.
- Design notes are in [docs/SYNC.md](docs/SYNC.md).

## How lookup works, in brief

1. **Filter.** Candidates are complete runs with results that pass hard filters:
   - same tool and template (or siblings);
   - same material;
   - fields marked "must match exactly";
   - the same set of gases (strict chemistry).
2. **Distance.** Each candidate gets a distance: the sum of weighted, spread-normalised differences in the inputs you entered.
3. **Weight.** Each candidate's weight combines similarity, recency (30-day half-life) and a penalty if a major tool event happened since.
4. **Summary.** The summary reports the closest run, adjusted by measured sensitivities where possible, the weighted average and range, the trend, a suggested time for a target thickness, and a confidence level with its reasons.

Every rule and constant is in [docs/ALGORITHM.md](docs/ALGORITHM.md). Half-life, event penalty and top-K are adjustable in Settings.

## Manual phone checklist

Run this on an iPhone (Safari) and an Android phone (Chrome) against the HTTPS address:

- [ ] Install the app (see above) and open it from the home screen; it opens full screen.
- [ ] Turn on airplane mode and reopen the app; every screen still works.
- [ ] Log a run with thumbs only: tool tile, steppers, material chip, Save.
- [ ] Take a camera photo from the run form; it appears as a thumbnail.
- [ ] Add a pre and a post measurement; the etch or deposition rate appears as "derived".
- [ ] Look up the same tool; results show an estimate, matches and a chart.
- [ ] On Log run, tap **LNF recipes**, pick a recipe and tap **Use recipe**; its values fill the form.
- [ ] Export a backup through the share sheet to Files or Drive.
- [ ] Import that file on a desktop; the run, measurements and photos (if included) appear.
- [ ] Deploy a new version; the app shows "Update available — Reload", and Reload updates it without losing a half-filled form.

## Development notes

- **Layout.**
  - `app/` is the whole static site.
  - `app/js/core/` holds pure logic (no DOM or storage) that is tested in Node.
  - `app/js/data/` is the IndexedDB layer; `app/js/ui/` the UI kit; `app/js/views/` one module per screen.
  - `scripts/` holds the line-limit check, version bump, icon generator, smoke test and Windows installer build.
  - `desktop/windows/` (C# with WebView2) and `desktop/macos/` (Swift with WKWebView) hold the desktop wrappers.
  - `test/` holds the Node tests.
  - `docs/` holds the data model, algorithm, decisions, deployment, desktop and sync notes.
- **Tests.** `npm test` runs `scripts/check-line-limits.mjs` (no file over 1000 lines) and `node --test`. The tests include every core module and the Section 11 worked example.
- **Version.** `npm run bump` updates `app/version.js` and the service worker cache name before a release.
- **Icons.** `npm run icons` regenerates the PNG icons without any image library.
- **Tool photos.** `npm run photos` downloads the LNF wiki's tool photos that the app does not ship yet, shrinks them in headless Chrome or Edge, and adds them to `app/img/tools/`, `app/js/data/tool-photos.js` and the service worker. Run it on the UMich network or VPN (the wiki refuses other connections), then release. `npm run photos -- --archive` uses the Internet Archive's copies instead.
- **Type checking (optional, not in CI).** Every JS file has `// @ts-check` and JSDoc types, so editors flag type errors. For a full check run `npx -p typescript tsc -p jsconfig.json`. This downloads TypeScript temporarily and adds nothing to the project.
- **No dependencies.** The app and all tooling use only the browser and Node built-ins.
- **Node version.** Use Node 22 or newer. Node 20 reached end of life in April 2026. Everything still runs on Node 20.14; the smoke test turns on Node 20's experimental WebSocket flag by itself.
- **Synology Drive.** If this folder lives in Synology Drive, note that it does not sync names that start with a dot (`.git`, `.github`, `.gitignore`).

## Privacy

All data stays in IndexedDB on your devices. The app makes no network requests other than loading its own files, checking for updates, showing a tool's photo from the LNF wiki when the app does not ship that photo, and, only if you turn on Sync, reading and writing your private GitHub repository through GitHub's API. Links to the wiki and its documents open in your browser only when you tap them. There are no analytics and no third-party scripts.

## License

Copyright © 2026 Nick Reynolds.

LNF Run Log is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

In plain words, anyone may use, copy, share and change the app, including inside a lab or company, as long as:

- every copy keeps the copyright notice and this license;
- changed versions are marked as changed and released under the same license, with their source code;
- anyone who runs a changed version for others over a network, such as hosting it as a website, offers those users the source.

So nobody can take the app private, rebrand it as a closed product, or wrap it in a service without sharing back.

LNF Run Log is an independent project. It is not made, endorsed or supported by the University of Michigan or the Lurie Nanofabrication Facility; "LNF" only names the facility whose tools it was built for.
