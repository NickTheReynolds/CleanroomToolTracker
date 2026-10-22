# Deploying LNF Run Log

The app is a folder of static files (`app/`). One HTTPS URL serves every platform: iPhone, Android, Windows, macOS and Linux. There is no server code and no build step.

## GitHub Pages (default)

GitHub Pages is free for public repositories and serves `*.github.io` over HTTPS.

- **Private repositories** need a paid GitHub plan for Pages, and the published site is public either way. Only the app code is published; your data stays on your devices.
- **Caching.** GitHub Pages sends a short cache lifetime (about 10 minutes). The service worker bypasses it when it installs a new version.

### One-time setup with GitHub Desktop (no command line)

GitHub Desktop needs the project folder to be a git repository (it has a `.git` folder). A copy synced by Synology Drive has none; see [When the phones do not see an update](#when-the-phones-do-not-see-an-update).

1. Open GitHub Desktop, choose **File → Add local repository…**, and pick this folder (`CleanroomToolTracker`).
2. Click **Publish repository**. Untick **Keep this code private**: free GitHub Pages needs a public repository. Only the app's code is published; your runs live on your devices, never in the repository.
3. On github.com, open the new repository → **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. When "Deploy to GitHub Pages" finishes, it shows the address `https://<user>.github.io/<repository>/`.
5. In the app, open **Settings → Install on your devices** and enter that address. The screen shows a QR code; scan it with each phone and follow the install steps for that phone.

Later changes ship with **Commit** and then **Push origin** in GitHub Desktop.

### One-time setup from the command line

1. Create a repository on GitHub and push this folder to its `main` branch.
2. In the repository, open **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main`. Two workflows run:
   - `.github/workflows/ci.yml` runs `npm test` on every push and pull request.
   - `.github/workflows/pages.yml` runs the tests again, stamps the commit into the service worker cache name, and publishes `app/`.
4. The site appears at `https://<user>.github.io/<repo>/`. All paths are relative and routes use `#/…`, so the sub-path works without any configuration.

### Releasing a change

1. Run `npm test`.
2. For a user-visible release, run `npm run bump` (patch), `npm run bump -- minor` or `npm run bump -- 2.0.0`. This updates `app/version.js`, the cache name in `app/sw.js` and `package.json` together.
3. Optional, on the UMich network or VPN: run `npm run photos` to ship the tool photos the app does not have yet.
4. Commit and push to `main`.

Installed apps check for a new service worker when they open or come back to the foreground. When a new version is ready they show **Update available — Reload**. The app never reloads by itself in the middle of data entry. Settings → About → **Check for update** checks on demand.

If you forget to bump, the deploy workflow's commit stamp still changes the cache name, so the update still arrives. The version number shown in Settings just stays the same.

### When the phones do not see an update

Phones and browsers load the app from the published address, not from this folder or from a desktop installer. A new version reaches them only after it is pushed to `main` and the "Deploy to GitHub Pages" run has finished.

1. Open `https://<user>.github.io/<repository>/version.js` in a private (incognito) window, or in a browser that has never opened the app. It shows the version and the commit the site serves. A browser where the app is installed shows its own cached copy instead. If the private window still shows the old version, the new one was never published: commit, push to `main`, and watch the **Actions** tab.
2. If the site serves the new version, open the installed app and wait a few seconds; **Update available — Reload** appears. If it does not, close the app completely and open it again, or tap **Settings → About → Check for update**.

**Synology Drive and git.** Synology Drive does not sync names that start with a dot. A copy of this folder on another computer therefore has no `.git` folder (it is not a repository and cannot push) and no `.github/workflows`. Push from the computer that holds the repository, or make this copy a repository once, keeping the workflows from GitHub:

```text
git init -b main
git remote add origin https://github.com/<user>/<repository>.git
git fetch origin
git reset origin/main
git branch -u origin/main
git checkout origin/main -- .github .gitignore
```

`git reset` here only moves git's bookkeeping; your files stay as they are. `git status` then lists your local changes, ready to commit and push. (Version 1.1 did not reach the phones for exactly this reason: it was built in a copy without `.git`, so it was never pushed.)

## Any other static host

Upload the contents of `app/` to any static web server that serves HTTPS. Service workers, installation and offline mode all require HTTPS; `localhost` is the only exception. Serve `.webmanifest` as `application/manifest+json` if the host lets you set types; most do this already.

### A Synology NAS

A Synology NAS can serve the app with its Web Station package. This route takes more setup than GitHub Pages, and it only works if the phones can reach the NAS:

1. Install Web Station.
2. Create a web portal that serves a copy of `app/`.
3. Give the portal a trusted HTTPS certificate. One option is **Control Panel → Security → Certificate → Add → Let's Encrypt** with a Synology DDNS name.
4. Make the NAS reachable over HTTPS from the phones, either from the internet (router port forwarding) or through a private VPN such as Tailscale, which also issues HTTPS names. Campus networks usually block incoming connections, so a NAS at home behind port forwarding, or a VPN, is the realistic setup.

Check the current DSM menus and the VPN provider's terms before relying on this. The installed app works offline either way; the address only needs to be reachable for the first install and for updates.

## Installed apps per platform

| Platform | What "the app" is | Built from |
|---|---|---|
| iPhone, iPad | A Home Screen web app (Safari → Share → Add to Home Screen, "Open as Web App" on): full screen and offline, with its own storage | The HTTPS address |
| Android | A WebAPK (Chrome → Install): a real installed app in the app drawer and Settings → Apps | The HTTPS address |
| Windows | `LNF-Run-Log-Setup-<version>.exe`: a per-user installer for a native window (WebView2) that bundles the app files and needs no hosting | `npm run build:windows` (see [DESKTOP.md](DESKTOP.md)) |
| macOS | `LNF Run Log.app` in a `.dmg`: a native window (WKWebView) that bundles the app files | `desktop/macos/build-macos.sh`, run on a Mac (see [DESKTOP-MACOS.md](DESKTOP-MACOS.md)) |
| Any desktop, without an installer | Chrome or Edge **Install**, or Safari **File → Add to Dock** | The HTTPS address |

Every installed copy keeps its own data. Move data between copies with **Settings → Backup and data**: export on one device, import on the other.

## Local development

```text
npm run serve            # http://localhost:8080 on this computer
npm run serve -- --lan   # also http://<pc-ip>:8080 for a phone on the same Wi-Fi
```

The service worker runs on `localhost`, so offline mode can be tested on the PC. Over plain `http://<pc-ip>` a phone gets no service worker and no offline mode. That is fine for quick layout checks, but use the HTTPS address for real use.

## Phase 2 (optional): a sync server

Phase 1 needs no server. If you later ask for sync (milestone 5), `server/sync-server.mjs` will be a single Node file with no dependencies. Phones can reach it only over HTTPS at an address they can see. Three ways to host it:

- **An always-on machine you control**, such as a lab PC or a small home server, behind an HTTPS reverse proxy with a real certificate.
- **A small hosted virtual machine or container** that runs Node 22+, with HTTPS in front.
- **A private network tunnel or mesh VPN** that gives the phone and the server HTTPS names on a private network.

This document names no provider on purpose. Check current pricing and terms before choosing one. The server's token comes from an environment variable and must never be committed. The app keeps working fully offline without the server.
