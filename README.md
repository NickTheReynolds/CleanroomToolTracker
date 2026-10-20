# LNF Run Log

LNF Run Log is an offline-first web app for logging and looking up process runs on cleanroom tools at the Lurie Nanofabrication Facility. It is built for one researcher, possibly with a few labmates. It runs from one codebase on iPhone, Android, Windows, macOS and Linux, and installs to the home screen like an app. There are no app stores, no accounts and no tracking.

The app has two jobs:

- **Capture.** Log a run on a phone in under 30 seconds while gowned and gloved: tool, recipe, parameters, and later the measured results.
- **Lookup.** Before a run, enter the planned tool, material and parameters. The app returns the most similar past runs and a plain-language estimate with its confidence and warnings.

Lookup uses no AI and no external services. The same input always gives the same output (see [docs/ALGORITHM.md](docs/ALGORITHM.md)). Your data stays in the browser storage of each device. Back it up from **Settings → Backup**.

## Quick start

You need Node.js 22 or newer, and only for the dev server and the tests. The app itself is plain HTML, CSS and JavaScript with no dependencies and no build step.

```text
npm test                 # line-limit check + all unit tests
npm run serve            # http://localhost:8080
npm run serve -- --lan   # also reachable from a phone on the same Wi-Fi (no offline mode over plain HTTP)
```

## Deploy

Push to GitHub and turn on Pages with **Settings → Pages → Source: GitHub Actions**. The site appears at `https://<user>.github.io/<repo>/`. Any static HTTPS host works too: upload the contents of `app/`. See [docs/DEPLOY.md](docs/DEPLOY.md) for setup, releases and updates.
