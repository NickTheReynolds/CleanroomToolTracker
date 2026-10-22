# LNF Run Log for macOS

> **UNTESTED.** The macOS app and these steps were written on a Windows PC. Nobody has built or run them on a Mac yet. Treat them as untested until someone builds the app on a Mac and works through the [first-run checklist](#first-run-checklist). Report anything that fails, with the full Terminal output.

**LNF Run Log.app** is a small native macOS app (Swift and AppKit) that shows the same web app as the PWA in a WebKit view. The web app's files are inside the app, so it works fully offline and needs no web address. The app makes no network requests of its own and never checks for updates.

## What you need

- **To run it:** macOS 12 Monterey or later, on Apple silicon or Intel (one universal app). Keep Safari updated: its updates also update the web engine the app uses.
- **To build it:** a Mac with the **Xcode Command Line Tools**. Install them once in Terminal with `xcode-select --install`. Full Xcode also works but is not needed. You need no Node.js, no Homebrew and no Apple developer account.

## Build

In Terminal, from the repository folder:

```text
bash desktop/macos/build-macos.sh
```

Start it with `bash` as shown; Windows and Synology Drive do not keep the file's execute permission. The script:

1. checks for the Swift compiler and reads the version from `app/version.js`;
2. compiles `desktop/macos/*.swift` for Apple silicon (arm64) and Intel (x86_64), and joins the two into one universal binary with `lipo`;
3. assembles `build/macos/LNF Run Log.app`: `Info.plist` with the version filled in, a copy of `app/` in `Contents/Resources/app`, the icon made from `desktop/macos/AppIcon-1024.png`, and the license;
4. signs the app ad hoc (`codesign --sign -`), which needs no certificate;
5. makes `dist/LNF-Run-Log-<version>-macOS.dmg`, holding the app, `LICENSE.txt` and an Applications shortcut for drag-to-install;
6. prints where both are.

The app carries its own copy of `app/`. After changing the web app, build again and reinstall. `bash desktop/macos/build-macos.sh --debug` makes a debug build with the Web Inspector always on.

## Install

1. Double-click the `.dmg` to open it.
2. Drag **LNF Run Log** onto the **Applications** shortcut next to it.
3. Eject the disk image, then start LNF Run Log from Applications, Launchpad or Spotlight. To keep it in the Dock, right-click its Dock icon and choose **Options → Keep in Dock**.

## Gatekeeper

- **Built on this Mac:** it opens normally. macOS checks only files that arrive from the internet.
- **A copy that came from the internet** (a browser, email, AirDrop or a chat app) is quarantined. The app has no Developer ID signature and is not notarized, so macOS refuses to open it at first ("Apple could not verify…"). Do the following only for a copy you trust:
  - **macOS 14 Sonoma and earlier:** in Applications, right-click (or Control-click) the app, choose **Open**, then **Open** again.
  - **macOS 15 Sequoia and later:** right-click no longer offers this. Try to open the app once, then go to **System Settings → Privacy & Security**, scroll down to the message about LNF Run Log, click **Open Anyway** and confirm.
- **Real distribution** to other people's Macs needs a paid Apple Developer Program membership: sign with a Developer ID Application certificate and the hardened runtime, then notarize with `xcrun notarytool` and staple the ticket. This project does not do that.

## Where your data lives

- Runs, tools, templates, measurements, events and photos are stored by WebKit in IndexedDB, under **`~/Library/WebKit/local.lnfrunlog.desktop/`**. WebKit decides the folders inside it, and they change between macOS versions, so do not edit them.
- Small extras live in `~/Library/Caches/local.lnfrunlog.desktop/`, `~/Library/HTTPStorages/local.lnfrunlog.desktop/` and `~/Library/Preferences/local.lnfrunlog.desktop.plist`. The last one holds the window's size and position.
- **This data is separate** from Safari, Chrome, Edge and any copy of LNF Run Log installed from the web address; each keeps its own. To move runs between them, or to another device, use **Settings → Backup, import and storage**: **Export backup** in one, **Import backup** in the other. Import merges and never deletes.
- **Export backup → Download** saves `lnf-runlog-backup-YYYY-MM-DD.json` in your Downloads folder and shows it in Finder. The first time, macOS asks whether LNF Run Log may use the Downloads folder: click **Allow**.
- The data is keyed by two names that must never change: the bundle id `local.lnfrunlog.desktop` and the web origin `lnfrunlog://app`. If either changed, the app would open empty; the old data would still be on disk but out of its reach.

## Update

1. Build or get the new `.dmg`.
2. Quit LNF Run Log.
3. Open the new disk image, drag the app to Applications and choose **Replace**.

Your data is kept, because it lives outside the app (see above). **Settings → About** shows the new version. macOS may ask again for access to the Downloads folder, because every build has a new ad hoc signature.

## Uninstall

1. Quit LNF Run Log.
2. Drag it from Applications to the Trash.

This leaves your data in place, so reinstalling brings everything back. To delete the data as well, **export a backup first: this cannot be undone.** Then, in Terminal:

```text
rm -rf ~/Library/WebKit/local.lnfrunlog.desktop \
       ~/Library/Caches/local.lnfrunlog.desktop \
       ~/Library/HTTPStorages/local.lnfrunlog.desktop \
       ~/"Library/Saved Application State/local.lnfrunlog.desktop.savedState"
defaults delete local.lnfrunlog.desktop
```

`defaults` reports an error if there was nothing to delete; that is harmless. Without Terminal: in Finder, choose **Go → Go to Folder…**, enter `~/Library/WebKit` and move the `local.lnfrunlog.desktop` folder to the Trash. Alternatively, run **Settings → Erase all data** in the app before you trash it.

## License

LNF Run Log is free software, licensed under the GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later). The full text is `LICENSE` at the root of the repository. The build copies it into the app as `LNF Run Log.app/Contents/Resources/LICENSE.txt` and puts `LICENSE.txt` next to the app in the disk image. **LNF Run Log → About LNF Run Log** shows the copyright line. If you pass the app on to others, the license requires that you also offer them its source code, which is this repository.

## How it works (for developers)

| File | What it does |
|---|---|
| `desktop/macos/AppDelegate.swift` | Entry point (`@main`), app lifecycle, quitting, Reload |
| `desktop/macos/MainMenu.swift` | The menu bar: app, Edit, View and Window menus |
| `desktop/macos/WebWindowController.swift` | The window and its `WKWebView`; which navigations stay in the app |
| `desktop/macos/WebUIDelegate.swift` | `alert`, `confirm` and `prompt` as native sheets; `<input type="file">` as the Open panel |
| `desktop/macos/Downloads.swift` | `WKDownload`: saves to Downloads and shows the file in Finder |
| `desktop/macos/AppSchemeHandler.swift` | Serves `Contents/Resources/app` at `lnfrunlog://app/` |
| `desktop/macos/AppInfo.swift` | Name, version and the fixed origin |
| `desktop/macos/Info.plist` | Bundle settings; the build fills in the version |
| `desktop/macos/build-macos.sh` | The build (see above) |
| `desktop/macos/AppIcon-1024.png` | Icon master, drawn by `scripts/make-icons.mjs` (`drawIcon(1024, {r: 0.32, corner: 0.22})`) |

- **Origin.** A `WKURLSchemeHandler` answers `lnfrunlog://app/<path>` with the file `<path>` from `Contents/Resources/app`. It sends the right types for HTML, JavaScript (`text/javascript`, which ES modules require), CSS, JSON, the web manifest, SVG, PNG and ICO; a missing file gets 404, and a path with `..` gets 403. Capacitor serves iOS apps from `capacitor://localhost` the same way. The window opens `lnfrunlog://app/index.html`.
- **Storage.** The web view uses WebKit's persistent default data store. The service worker does not run under a custom scheme, and it is not needed: every file is local.
- **Desktop flag.** At document start the app defines `window.LNF_DESKTOP = {platform: 'macos', version: '<version>'}`, as the Windows app does. The web app then skips the service worker and the persistent-storage request, and explains how to update (`docs/DECISIONS.md`, decision 48).
- **Links.** `http`, `https` and `mailto` links to anything outside the app open in the default browser or mail app; other schemes are ignored. `window.open` never opens a second window.
- **Downloads.** The backup and CSV exports click an `<a download>` link to a `blob:` URL. The app turns that into a `WKDownload` (macOS 11.3+), saves it in `~/Downloads` (as `name (1).json` and so on when the name is taken) and shows it in Finder.
- **Window.** The size and position are restored at the next start. The title follows the page title. Closing the window quits the app, as on Windows.
- **Quitting** hides the window, then waits half a second. Hiding the page makes the web app save a half-typed form at once (`app/js/ui/autosave.js`), and IndexedDB gets time to commit it.
- **Crash recovery.** If the web content process dies, the page reloads; forms autosave, so nothing is lost.
- **Web Inspector** (macOS 13.3 or later): use a `--debug` build, or start a normal build with `--devtools`: quit the app, then run `open -a "LNF Run Log" --args --devtools` (`open` passes arguments only when it starts the app). In Safari, turn on **Settings → Advanced → Show features for web developers** (in Safari 16: **Show Develop menu in menu bar**), then choose **Develop → (this Mac) → LNF Run Log**.

## Troubleshooting

- **`xcrun: error: invalid active developer path`** or **swiftc not found:** run `xcode-select --install`, then build again.
- **`$'\r': command not found`**, **`set: pipefail: invalid option name`** or **`bad interpreter`:** the script got Windows line endings on its way to the Mac. Fix it with `sed -i '' $'s/\r$//' desktop/macos/build-macos.sh` and run it again.
- **Swift compile errors:** this code has never been compiled, so please report the full output together with `xcrun swiftc --version` and your macOS version.
- **`codesign` complains about "detritus":** the script builds in a temporary folder and strips extended attributes, so this should not happen. If it does, report it.
- **A blank window:** start the app with `--devtools` (above) and look at the Web Inspector's Console.
- **"LNF Run Log is damaged and can't be opened"** (a downloaded copy): macOS sometimes says this about quarantined apps that are signed ad hoc. For a copy you trust, run `xattr -dr com.apple.quarantine "/Applications/LNF Run Log.app"`.
- **Export saves nothing:** macOS may have blocked access to Downloads. Turn it on in **System Settings → Privacy & Security → Files and Folders → LNF Run Log**, then export again.

## First-run checklist

Work through this on the first Mac that builds the app, and note each result:

1. **Build.** `bash desktop/macos/build-macos.sh` ends with "Done", prints the paths of the app and the `.dmg`, and the `lipo` line lists both `x86_64` and `arm64`.
2. **Install.** The disk image shows LNF Run Log, an Applications shortcut and `LICENSE.txt`. Drag the app to Applications and eject the image.
3. **Launch.** Start it from Applications. The window opens on Home with no Gatekeeper warning, the Dock shows the wafer icon, and the menu bar shows LNF Run Log, Edit, View and Window. **About LNF Run Log** shows the version and the AGPL copyright line.
4. **Desktop flag.** **Settings → About** says it is the macOS desktop app, with the version.
5. **Log a run.** Home → **Log run**, pick a tool, fill in a few fields and save. The run appears on Home.
6. **Restart.** Move and resize the window, quit with ⌘Q and start the app again. The run is still there, and the window has its new size and place. Then type something into a form field, press ⌘Q at once, start again and open the same form: what you typed is still there.
7. **Copy and paste.** In a text field such as Notes, type some text, then use ⌘A, ⌘C, click another field and ⌘V. ⌘Z undoes it. The same commands work from the Edit menu.
8. **Export a backup to Downloads.** **Settings → Backup, import and storage → Export backup → Download.** If macOS asks about the Downloads folder, click **Allow**. Finder opens with `lnf-runlog-backup-YYYY-MM-DD.json` selected. Export again: a second file named `… (1).json` appears, and the first one is untouched.
9. **Import it.** **Import a backup → Choose backup file…** opens the Open panel as a sheet. Pick the file. The summary counts the records as skipped (they are already here) and nothing is deleted.
10. **Open an external link.** Home → **Log run**, pick an LNF tool such as LAM 9400, tap **?** next to its name, then **Tool page**: the LNF wiki page opens in your default browser and the app stays on its page. Then check the script paths in the console: Quit, run `open -a "LNF Run Log" --args --devtools`, and open the app's Console from Safari's Develop menu. Run `location.href = 'https://example.com'`, then `window.open('https://example.com')`. Each opens the page in your default browser, while the app stays on its own page. Also run `alert('hi')`, `confirm('OK?')` and `prompt('Name?', 'x')`: each shows a native sheet, and the console shows what it returns.
11. **Reload and close.** **View → Reload** (⌘R) reloads the page and stays in the app. Closing the window with its red button quits the app.
