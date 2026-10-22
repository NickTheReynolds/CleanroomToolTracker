# Syncing across devices with periodic manual syncs (design notes)

## Built: sync through a private GitHub repository

This is option A below, the per-device snapshot design, with a private GitHub repository as the shared folder, reached directly from the app. Any phone with internet can sync; no Synology app, lab PC or VPN is needed. Code: `app/js/sync/` (`github.js` client, `codec.js`, `plan.js` merge rules, `sync.js` orchestration) and `views/settings-sync.js`.

**Layout and contents**

- **One file per device:** `lnf-runlog-sync/devices/<deviceId>.lnfsync`, gzip-compressed JSON, read by its magic bytes.
- **What's in it:** `{format: "lnf-runlog-sync", version, appVersion, exportedAt, deviceId, deviceName, author, stores: {tools, templates, runs, measurements, events}, materials}`.
  - Tombstones are included.
  - Photos and settings are left out, and the token never is in it (a test checks that).

**One sync**

1. Check the repository is reachable and **private**; a public repository is refused.
2. Download each other device's file whose blob SHA changed since the last sync (`settings.sync.seen`).
3. Merge each one with the import merge plus a tie-break: the newer `updatedAt` wins; an equal one goes to the higher `deviceId`, so every device converges.
4. Recompute derived results for the runs touched.
5. Write this device's file. A write conflict (409/422) is retried once with the current version.

**Properties**

- **Order doesn't matter:** merging full snapshots is order-independent and idempotent, so devices can sync whenever they like.
- **No write conflicts:** each device writes only its own file.
- **History:** every sync is a commit, so the repository history is a versioned backup.

**Access**

- A fine-grained token with *Contents: Read and write* on that one repository. GitHub's fine-grained tokens cannot reach a personal repository you are only a collaborator on, so:
  - a group shares one token, or
  - uses an organization-owned repository with a token per person.
- The token is stored only in this device's settings (`settings.sync`) and is excluded from backups.
- Requests go only to `api.github.com`, only when Sync runs. A test checks that no other module mentions that host.

**Later options**

- Optional passphrase encryption (WebCrypto AES-GCM).
- Automatic sync when the app opens.
- Photos as separate files.
- A lab-PC hub, using the same merge rules with a different transport.

---

The original exploration follows.

**Status when written: speculative.** This note explores how one person, and later a few labmates, could keep the same runs on several devices by tapping **Sync** now and then (for example at the end of a cleanroom day) instead of syncing continuously. It is meant to inform milestone 5 (spec Section 13) and possibly replace parts of it.

## Where we start

The devices that would sync, each with its own separate IndexedDB:

- the browser or installed web app on each phone (iPhone, Android);
- the Windows desktop app (WebView2, origin `https://app.lnf-runlog.example`);
- the macOS desktop app (WKWebView, origin `lnfrunlog://app`);
- a browser tab on any computer.

Even on one PC, the desktop app and a browser tab do not share data.

Several things already make sync tractable:

- **Records merge cleanly.** Every record has a UUID, an `updatedAt` that only moves forward on each device, a `deviceId`, and a `deleted` tombstone instead of physical deletion. Merging "the newer `updatedAt` wins, per record" is a state-based CRDT (a last-writer-wins map with tombstones). Merging full snapshots in any order and any number of times converges to the same state, provided ties are broken the same way everywhere (spec: the higher `deviceId` wins).
- **The merge already exists.** Backup import (`data/export-import.js`, `planImport`) is exactly this merge. It currently keeps the local record on a tie, so sync must switch to the `deviceId` tie-break.
- **Seed records never duplicate**, because their ids are fixed.
- **The infrastructure is already there.** You already run Synology Drive, which syncs a folder across your PCs, and its mobile apps expose that folder to the phone's file picker.

## Options

### A. A shared "sync folder" of per-device snapshot files (recommended first step)

**The idea**

1. Each device owns one file in a shared folder, for example `LNF Run Log Sync/Ana-iPhone.a1b2c3d4.lnfsync.json`. The file is a full snapshot: the same content as a backup, without photos, plus the device's id and name and the time.
2. **Sync** writes your own file, then reads every other device's file and merges it in.
3. Because snapshots merge order-independently, everyone converges after a round or two of syncs. No device needs to be online at the same time as any other.

**How each device would do it**

| Device | Write own file | Read others | Taps per sync |
|---|---|---|---|
| Windows app | Native file access through a small WebView2 host object (C# reads and writes the folder chosen once) | Same | 1 |
| macOS app | Native file access through a WKScriptMessageHandler bridge (Swift) | Same | 1 |
| Chrome or Edge on desktop | File System Access API: pick the folder once and keep the handle; the browser re-asks for permission once per session | Same | 1–2 |
| iPhone (web app) | **Share → Save to Files →** the Synology Drive (or iCloud) folder, replacing the old file | `<input type="file" multiple>` in Files, picking the other devices' files | about 4–6 |
| Android (web app) | Share to the Synology Drive app, or Download and then move the file | The system file picker, multi-select | about 4–6 |

**Why it fits periodic manual syncing**

- No server and no account.
- Any folder sync works as the transport: Synology Drive, iCloud Drive, OneDrive, even a USB stick.
- Every sync file doubles as a dated **backup**.
- It reuses the existing import merge and file export code, so it is small to build:
  1. a Sync screen with "last synced" status;
  2. the per-device file name;
  3. the `deviceId` tie-break;
  4. recomputing derived results for runs touched by the merge;
  5. on desktop, the native folder bridge.

**Costs and caveats**

- Phones need several taps, because iOS and Android web apps cannot open a folder directly. The Files-app integration of the Synology Drive mobile apps should cover it, but test it on both phones before relying on it.
- Snapshots are whole-database files. That is fine at lab scale (a few MB for thousands of runs, without photos).
- Photos are left out, as in spec v1. A run would show "photo on another device". A later option is a per-device `photos/` subfolder of JPEGs, written only by the desktop apps.
- The folder holds plain JSON. Keep it in your own Synology space, or add optional passphrase encryption (WebCrypto AES-GCM with a PBKDF2-derived key; small and dependency-free).

### B. A sync server on hardware you control (spec milestone 5)

**The idea**

- Run the spec's `server/sync-server.mjs` (Node built-ins, append-only JSONL per store, an increasing `seq` cursor, bearer token).
- It could run on the Synology NAS (Container Manager) or on an always-on lab PC.
- **Sync now** pushes the records changed since the last sync, then pulls everything after the cursor: one tap on every device, wherever it is.

**Reachability is the hard part**

- Phones run the app from an HTTPS origin, so they can only call an **HTTPS** server they trust. A plain `http://192.168.x.x` address on the Wi-Fi is blocked as mixed content and by Private Network Access.
- Campus Wi-Fi often blocks device-to-device traffic as well.

There are two practical ways to reach it:

1. **A private VPN such as Tailscale**: the NAS and the phones join one private network, and the NAS gets a real HTTPS name.
2. **Public exposure**: router port forwarding, a domain and Let's Encrypt. This needs careful token handling and updates.

**Best when** you want one-tap syncing on phones, or several labmates syncing daily. The merge rules are the same as in option A, so A's code carries over.

### C. The Windows app as a hub on the local network

The desktop app could host the sync endpoint itself, so phones sync with the lab PC while they are on the same network. In practice this is option B with the PC as the server, and it inherits the same HTTPS-reachability problem.

It becomes workable with a VPN like Tailscale (real certificates for the PC's private name). The extra problem is that the PC must be on and running the app when a phone wants to sync.

### D. QR-code hand-off (no network at all)

Each device shows its changes as a QR code, or an animated sequence of codes, and the other device scans them with its camera. One large QR code holds about 3 KB; a day's runs compress to a few codes. This works in a cleanroom with no signal and needs no folder, server or account.

The costs:

- a JavaScript QR *decoder* (iOS Safari has no built-in barcode detector);
- camera handling;
- a careful protocol for multi-code streams;
- a camera on the desktop.

It is a fun fallback, but more machinery than option A for less convenience.

### E. Third-party cloud storage APIs (Google Drive, Dropbox, OneDrive)

The app could sign in with OAuth and keep a sync file in your cloud storage: one tap everywhere, and no server of your own. It needs an OAuth client registration, and it sends lab data to a third party, which conflicts with the spec's "only to a server the user controls". University accounts may also restrict third-party apps. Not recommended unless those constraints change.

## Details that matter whichever option you pick

- **Clock trust.** Last-writer-wins trusts device clocks. A phone set an hour ahead would win every conflict for that hour. A *hybrid logical clock* fixes this cheaply: it stores wall time, a counter and the device, and advances past any timestamp it has seen during a merge.
- **Conflicts inside one record.** Whole-record last-writer-wins drops one side when two devices edit the same run between syncs, say notes on the phone and parameters on the PC. Per-field timestamps (a last-writer-wins map per run) keep both edits. This is rare for a single user, so per-record is a fine start.
- **Derived values.** After a merge brings in measurements from another device, recompute the derived results of the affected runs. They depend on the measurement set.
- **Tombstones.** Deletions travel as tombstones and are never purged. At lab scale that is free; a future cleanup could drop tombstones every device has seen.
- **Labmates.** With a shared sync folder or server, everyone sees everyone's runs (`author` shows who logged what), and anyone can edit or delete them. That trust model suits a small group; per-person write rules would need a server (option B).
- **Reminders.** A Home banner, "Last synced 9 days ago", would work like the backup reminder.
- **Safety.** A sync only adds, updates or tombstones records by the merge rules; it never wipes anything. The device's own sync file is written before others are read, so a crash mid-sync loses nothing.

## Suggested path

1. **S1, the sync folder (option A).** Build it first:
   - one tap on the Windows and macOS apps and in Chrome or Edge;
   - a short guided two-step flow on the phones;
   - the `deviceId` tie-break and derived-value recompute after a merge;
   - the "last synced" status and reminder.

   This is small, needs no infrastructure beyond Synology Drive, and doubles as automatic backups.
2. **S2, only if phone syncing feels too fiddly:** add the milestone 5 server on the NAS, reached through a private VPN, with the same merge rules. Phones get one-tap sync.
3. **Hybrid logical clocks and per-field merging,** if real conflicts ever show up.
