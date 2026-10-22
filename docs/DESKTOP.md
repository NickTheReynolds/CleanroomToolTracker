# LNF Run Log for Windows

**LNF Run Log.exe** is a small native Windows app (C# and WinForms) that shows the same web app as the PWA in a Microsoft Edge WebView2 window. The web app's files are installed with it, so it works fully offline and needs no web address. It installs for one Windows account, never asks for administrator rights, and makes no network requests of its own.

Tested on Windows 11 (x64) with WebView2 Runtime 155. Windows 10 and Windows on Arm have not been tried.

## What you need

- **To run it:** 64-bit Windows 10 or 11 with the **Microsoft Edge WebView2 Runtime**. Windows 11 includes it, and most Windows 10 PCs get it with Microsoft Edge. If it is missing, the app says so and offers Microsoft's download page; install the "Evergreen" runtime. The .NET Framework 4.8 it uses is part of every current Windows 10 and 11.
- **To build it:** Windows 10 (version 1803 or later) or 11, Node.js 22 or newer (Node 20.14 also works), and internet access for the first build. There is no Visual Studio and no .NET SDK: the build uses the C# compiler of the .NET Framework (`csc.exe`) and `tar.exe`, which ship with Windows.

## Build

```text
npm run build:windows                # node scripts/build-windows.mjs
npm run build:windows -- --smoke     # build, then install into a temp folder and test it
```

The build:

1. copies `app/` into a new temp folder, stamping only the **copies** of `sw.js` and `version.js`: the cache name becomes `lnf-runlog-v<version>-d<hash8>` and `APP_BUILD` becomes `desktop-<hash8>`, where `hash8` is the start of a SHA-256 over the app files. `app/` itself is never changed. It refuses to go on if the files it found differ from the service worker's `ASSETS` list;
   - Why a temp folder: Synology Drive turns new files in the synced folder into placeholders while the build runs. A listing taken during that once left `js/ui/` and `icons/` out of the setup, and the installed app hung at "Loading…";
2. draws `LNF Run Log.ico` (16 to 256 px) with `scripts/ico.mjs`, from the same design as the PWA icons;
3. downloads the WebView2 SDK (NuGet package `Microsoft.Web.WebView2`, pinned to 1.0.4191.47) into `.cache/webview2/` once, checks its SHA-256 on every build, and extracts only the three DLLs it needs and the package license;
4. copies the project's `LICENSE` unchanged as `LICENSE.txt`, and writes `THIRD-PARTY-NOTICES.txt` for the WebView2 files;
5. compiles `LNF Run Log.exe` (x64) from `desktop/windows/`, then the setup, which carries every payload file inside it;
6. writes **`dist/LNF-Run-Log-Setup-<version>.exe`** (about 1.4 MB) and prints its path and size.

`--smoke` then checks the installer from start to end, in a new temp folder and without touching the registry, the Start menu or the Desktop. It runs a silent install, then reads the shortcuts' target and taskbar id. It opens the app over the DevTools protocol and checks the home screen, the desktop flag, and data kept in IndexedDB across a restart. It ends with a silent uninstall that keeps the data. The temp folder is deleted when the test passes, and a screenshot is left at `build/windows/smoke-home.png`.

`build/`, `dist/` and `.cache/` are build outputs and are not committed. Synology Drive syncs `build/` and `dist/`, but not `.cache/` (it skips names that start with a dot).

**Updating the WebView2 SDK.** Choose the newest stable version that has been out for at least a month (see `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json` and the NuGet registration dates). Download its `.nupkg`, check its SHA-512 against `packageHash` in NuGet's catalog, then put the version and the file's SHA-256 into `WEBVIEW2_VERSION` and `WEBVIEW2_SHA256` in `scripts/build-windows.mjs`.

## Install

1. Run `LNF-Run-Log-Setup-<version>.exe`. The dialog shows the version, says it installs for this Windows account only with no administrator rights, and names the folder and the license.
2. Leave **Desktop shortcut** and **Start LNF Run Log when done** ticked, or untick them, and click **Install**.

It installs into `%LOCALAPPDATA%\Programs\LNF Run Log`, adds **LNF Run Log** to the Start menu and, if ticked, to the Desktop (also a OneDrive-redirected Desktop), and lists it under **Settings → Apps → Installed apps**. Pinning it to the taskbar works as usual; the running window groups with the pin.

### SmartScreen

The installer is not code-signed. When a copy arrives **from the internet** (a browser download, email or chat), Windows SmartScreen may stop it with "Windows protected your PC". For a copy you trust, click **More info → Run anyway**. A copy built on this PC, or one that arrives through Synology Drive, usually carries no "downloaded from the internet" mark and is not flagged. Signing would need a paid code-signing certificate; this project does not do that.

### Silent install and test options

| Option | Effect |
|---|---|
| `/S` | No dialog. Answers yes to every question (it closes a running copy of the app). |
| `/D=<folder>` | Install folder. It must be new, empty or an existing LNF Run Log install. |
| `/SHORTCUTS=<folder>` | Put both shortcuts in `<folder>\Start Menu` and `<folder>\Desktop` instead (for tests). |
| `/NOREG` | No Installed apps entry (for tests). |
| `/NODESKTOP`, `/NOLAUNCH` | No desktop shortcut; do not start the app afterwards. |
| `/uninstall` | Uninstall instead (see below). |

Exit codes: 0 done, 1 failed (silent mode prints the reason on stderr), 2 unknown option, 3 cancelled.

## Update

Run the newer setup. It finds the existing install and offers **Update**. If LNF Run Log is open, the setup asks before closing it, and offers to force it closed only if it does not close by itself. The update replaces the program files, including the whole `app` folder, so files a newer version dropped do not linger. Your data is not touched. **Settings → About** shows the version.

The app reads its files fresh from the install folder at every start (WebView2 does not keep them in its disk cache), so an update takes effect the next time it starts.

## Uninstall

Use **Settings → Apps → Installed apps → LNF Run Log → Uninstall**. The dialog removes the program, its shortcuts and its Installed apps entry. **Your run data stays** unless you tick **Also delete my run data (cannot be undone; export a backup first)**; the box is unticked by default, and ticking it asks once more before deleting.

Silently: `"%LOCALAPPDATA%\Programs\LNF Run Log\Uninstall LNF Run Log.exe" /S`. A silent uninstall always keeps the data.

## Where your data lives

- Runs, tools, templates, measurements, events, projects, photos and settings are in WebView2's IndexedDB under **`%LOCALAPPDATA%\LNF Run Log\WebView2`**. The same folder holds `window.txt` (the window's size, position and maximized state). WebView2 decides the folders inside it, so do not edit them.
- **This data is separate** from Edge, Chrome, any copy of LNF Run Log installed from the web address, other Windows accounts and other PCs; each keeps its own. To move runs between them, use **Settings → Backup, import and storage**: **Export backup** in one, **Import backup** in the other. Import merges and never deletes.
- **Export backup → Download** saves `lnf-runlog-backup-YYYY-MM-DD.json` to your Downloads folder and shows it in the app's downloads panel.
- Do not put the data folder in OneDrive or Synology Drive: syncing a live database can corrupt it. Backups are the way to move data.
- The data is keyed by the app's origin, `https://app.lnf-runlog.example`, which must never change. If it did, the app would open empty; the old data would still be on disk but out of its reach.

## License

LNF Run Log is free software under the GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later). The full text is `LICENSE` at the root of the repository. The build copies it unchanged into the install folder as `LICENSE.txt`, and the setup dialog names the license. `THIRD-PARTY-NOTICES.txt` carries the license of the bundled Microsoft WebView2 files. If you pass the app on to others, the AGPL requires that you also offer them its source code, which is this repository.

## How it works (for developers)

| File | What it does |
|---|---|
| `desktop/windows/Launcher.cs` | The app: a WinForms window hosting WebView2; origin, links, desktop flag, crash recovery |
| `desktop/windows/Placement.cs` | Saves and restores the window in `window.txt` |
| `desktop/windows/Shell.cs` | Shared names and the data folder; taskbar id; `.lnk` shortcuts via `IShellLinkW` and `IPropertyStore` |
| `desktop/windows/Setup.cs` | Setup entry point, options, install and uninstall steps, Installed apps entry |
| `desktop/windows/SetupFiles.cs` | Payload extraction and removal, closing running copies, deleting data |
| `desktop/windows/SetupForm.cs` | The install, update and uninstall dialog |
| `scripts/build-windows.mjs` | The build and `--smoke` test; its pure helpers are tested by `test/windows-build.test.mjs` |
| `scripts/ico.mjs` | `.ico` writer (`encodeIco`) and the app icon |

- **Compiler.** `csc.exe` from `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319` supports only C# 5: no `$"…"`, `?.`, `nameof`, expression-bodied members, auto-property initializers or `out var`. `test/windows-build.test.mjs` checks for these, and on Windows compiles the setup sources. The build also generates `BuildInfo.cs` (version and build id) and the application manifests: never elevate, and per-monitor DPI awareness for the app.
- **Origin.** `SetVirtualHostNameToFolderMapping` serves the `app` folder next to the exe as `https://app.lnf-runlog.example/` (`.example` is reserved and never resolves on the internet), and the window opens `index.html`.
- **Profile.** The user data folder is `%LOCALAPPDATA%\LNF Run Log\WebView2`. The environment variable `LNF_RUNLOG_DATA` replaces `%LOCALAPPDATA%\LNF Run Log` (tests only). Every launch uses identical environment options, so several windows can share the profile.
- **Desktop flag.** At document creation the app defines `window.LNF_DESKTOP = {platform: 'windows', version: '<version>'}`. The web app then skips the service worker and the persistent-storage request (`docs/DECISIONS.md`, decision 48). The stamped cache name in `sw.js` matters only if a service worker ever runs.
- **Links.** Navigations and `window.open` to any other origin open in the default browser (`http`, `https` and `mailto` only; other schemes are ignored). `window.open` never opens a second window; a link to the app itself stays in the window.
- **Window.** The title follows the page title; the title bar is dark when Windows apps use dark mode. Closing hides the window at once and ends the process half a second later. Hiding makes the web app save a half-typed form (`app/js/ui/autosave.js`). In testing, a plain close kept such a form too, so this is extra insurance.
- **Taskbar.** The process sets the AppUserModelID `LNFRunLog.Desktop`, and both shortcuts carry the same id and the icon.
- **Crash recovery.** If the page's process dies, the page reloads (forms autosave). If WebView2 itself stops, the app says so and closes.
- **DevTools** are off. Start `"LNF Run Log.exe" --devtools` to allow F12 and right-click → Inspect.
- **Downloads** use WebView2's own download panel and the Downloads folder.
- **Setup payload.** Each payload file is a resource named `payload/<relative path>`. The setup extracts the top-level files first, then replaces `app\` whole. Before it changes anything, it checks that no program file is locked.
- **Running copies.** The setup closes only `LNF Run Log.exe` processes whose path is inside the install folder; it compares final paths, so junctions are handled. It asks before closing them and before forcing them closed.
- **Uninstall.** It deletes only the files the payload names, the `app` folder and the uninstaller; any other file in the folder stays. The installed uninstaller deletes itself after it exits, through a hidden `cmd /c ping … & del … & rmdir`. The Installed apps entry is `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\LNFRunLog`, and it is removed only when its `InstallLocation` is this folder.

## Troubleshooting

- **"LNF Run Log needs the Microsoft Edge WebView2 Runtime":** install the Evergreen runtime from the page the app offers, then start it again.
- **"The app could not open its database" while testing with `LNF_RUNLOG_DATA`:** the path is too long. Chromium's IndexedDB fails once its files pass Windows' 260-character limit, about 100 characters below the data folder. Keep that folder's path under about 110 characters. The default location is far shorter. `--smoke` checks the length of `%TEMP%` for the same reason.
- **A blank window or a page error:** start the app with `--devtools`, press F12 and read the Console.
- **"The app files are missing" or "WebView2Loader.dll is missing":** run the setup again to repair the install.
- **The setup says a file is in use:** close LNF Run Log (check Task Manager for "LNF Run Log"), then run the setup again. Nothing was changed.
- **The setup refuses a folder:** `/D` must name a new folder, an empty one or an existing install.
- **`csc.exe failed`:** the output lists the compiler errors. A C# 6 feature is the usual cause (see Compiler above). "Could not write to output file" means the setup exe is still running or locked.
- **`SHA-256 MISMATCH`:** the download is not the pinned package (a proxy or a corrupt transfer). Try again later. Change the pin only on purpose, as described under Build.
