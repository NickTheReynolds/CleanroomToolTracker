# Deploying LNF Run Log

The app is a folder of static files (`app/`). One HTTPS URL serves every platform: iPhone, Android, Windows, macOS and Linux. There is no server code and no build step.

## GitHub Pages (default)

GitHub Pages is free for public repositories and serves `*.github.io` over HTTPS.

- **Private repositories** need a paid GitHub plan for Pages, and the published site is public either way. Only the app code is published; your data stays on your devices.
- **Caching.** GitHub Pages sends a short cache lifetime (about 10 minutes). The service worker bypasses it when it installs a new version.

### One-time setup

1. Create a repository on GitHub and push this folder to its `main` branch.
2. In the repository, open **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main`. Two workflows run:
   - `.github/workflows/ci.yml` runs `npm test` on every push and pull request.
   - `.github/workflows/pages.yml` runs the tests again, stamps the commit into the service worker cache name, and publishes `app/`.
4. The site appears at `https://<user>.github.io/<repo>/`. All paths are relative and routes use `#/…`, so the sub-path works without any configuration.

### Releasing a change

1. Run `npm test`.
2. For a user-visible release, run `npm run bump` (patch), `npm run bump -- minor` or `npm run bump -- 2.0.0`. This updates `app/version.js`, the cache name in `app/sw.js` and `package.json` together.
3. Commit and push to `main`.

Installed apps check for a new service worker when they open or come back to the foreground. When a new version is ready they show **Update available — Reload**. The app never reloads by itself in the middle of data entry. Settings → About → **Check for update** checks on demand.

If you forget to bump, the deploy workflow's commit stamp still changes the cache name, so the update still arrives. The version number shown in Settings just stays the same.

## Any other static host

Upload the contents of `app/` to any static web server that serves HTTPS. Service workers, installation and offline mode all require HTTPS; `localhost` is the only exception. Serve `.webmanifest` as `application/manifest+json` if the host lets you set types; most do this already.

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
