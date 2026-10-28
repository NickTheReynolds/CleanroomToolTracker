# Changelog

One entry per milestone (spec Section 16).

## 1.8.0: Failed projects in red, finished ones in green

- **Mark a project failed.** On the project page, **Mark failed** asks what went wrong (optional) and ends the project. The editor's Status has **Failed** too, with the same box.
- **Red and green at a glance.** A failed project's card is red, with a red band down its left edge and a **Failed** badge. A finished one's is green, with a **Finished** badge. The top of the project page takes the same colour, and a failed project says what went wrong under its name.
- **Its own group.** Projects lists failed projects under **Failed**, after **Finished**.
- **Changing your mind.** **Reopen** makes a failed or finished project active again. **Mark finished** turns a failed project into a finished one, and **Mark failed** a finished one into a failed one; both keep the day it ended. Marking a project failed again starts from what you wrote before.
- **Trying again.** **Copy project** on a failed project starts the next batch as active, without the failure.
- **Exports.** The traveler PDF says the project failed, when, and what went wrong. The workbook's Projects sheet has a **What went wrong** column, and its "Finished" column is now **Ended**.
- **Older versions keep syncing.** A failed project is stored as a finished one with a mark. A device still on 1.7 or before accepts it, shows it as finished, and keeps the mark when it saves the project.

## 1.7.0: Clearer screens, and your projects on Home

- **Your projects on Home.** Home lists your active projects, the most recently active first. Each card has a bar with a segment per step: green for done, blue for in progress, gray for to do. Under the bar are the step in progress (or the next one) and when anything last happened. Projects someone else started, shared through sync, stay on the Projects screen; Home says how many there are.
- **Sections stand apart.** A section's title is now larger and brighter than its field labels, with a line and space above every section after the first. Field labels are quieter, so the values stand out.
- **Less blue on blue.** In the dark theme the page, cards and fields are now graphite, each a clear step apart. Fields sit in a darker well, so they no longer look like buttons or cards. Blue stays for the app bar, actions, links and what you have chosen. The "i" buttons, icons that only decorate a row and a list row's own buttons (move, remove) are gray.
- **Steps in colour.** In a project's plan, done steps have a green check, a step in progress a blue clock and the rest a gray flag. The project's progress bar has a segment per step. Wafer and project names on runs are gray tags, so they no longer look like states.
- **Under the hood.** A new colour token, `--field`; the contrast test now covers fields and the step bar. `ownedBy` in `core/projects.js` decides whose a project is.

## 1.6.0: Pictures, files and GDS layouts on plan steps

- **Pictures and files on every plan step.** Open a step on the project page:
  - **Add picture** takes or picks photos (resized like run photos);
  - **Add file** keeps any file as it is, up to 100 MB: a microscope image, a profile, a PDF;
  - tap one to see it, download it or remove it (with Undo).
- **Offered when a step is finished.** After **Mark done without a run**, or when a run linked to a step is saved or marked complete, the message has **Add picture or file**. It opens that step.
- **A GDS layout on exposure steps** (aligners, steppers, the laser writers, the mask maker, e-beam lithography; optional):
  - the GDS file itself, which you can download again from the step;
  - its name, top cell, layer, and where it is kept (a web link opens).
- **Names everywhere, files on the device that added them.** A step's pictures, files and layout sync with the project, but the files themselves stay on the device that added them, like run photos. Your other devices list them as "On another device".
  - **Backups** can include them: **Include photos and files**.
  - **Copy project** keeps each step's GDS layout, but not its pictures and files.
- **The traveler** names each step's layout and files, in the PDF and in the workbook's Plan sheet.

## 1.5.2: Copy a project from its folder, Expose time on the mask maker

- **Copy a project from its folder.**
  - Every project card on a folder page has **Copy**. It opens the Copy project form, already filled in.
  - **Select** can copy several projects at once, with Undo.
  - A copy's name counts on: "…ShadowMask_1" becomes "…ShadowMask_2" and "Batch 3" becomes "Batch 4". Other names still get "(copy)".
- **Expose time on the Heidelberg µPG 501 Mask Maker.**
  - Its template has a new input, **Expose time** (ms), after Dose.
  - The wiki recipe "Direct writing on mask blanks" now fills it with LNF's posted 45 ms.
  - Installed copies get the field on their next start, added to the template as you have it: your other edits stay. Nothing is added if the template already has an Expose time field or was deleted.

## 1.5.1: Materials the app does not know

- **No more silent misses.** A material the plan checks don't recognize now gets a **Check** wherever a rule could apply to it, and the note names the rule. Examples: a tool that allows no metals or resists, a CMOS-clean tool, a furnace that takes silicon only, an anodic or fusion bond. In 1.5.0 such a name raised nothing.
  - **Every word counts, brackets included.** "PZT on Si", "Amorphous selenium", "FTO glass" and "Si (with PZT)" are asked about. Words that only say how, how much or in what state are not: "p+ Si", "Si, p-type", "B-doped Si", "Bare Si" and "Ti/Au 10/100 nm" are known.
  - **A list is asked about by its unknown part.** For "Ti/PZT", the note asks about PZT and Ti stays a metal.
- **What is PZT?** Tap the button on the note and pick what the material is:
  - silicon, or a silicon oxide or nitride (or another dielectric with no metal in it);
  - a metal, fast-diffusing or not, or a compound of one;
  - something else that is not CMOS-clean;
  - a resist or polymer;
  - glass with sodium, or glass without sodium (AF32, Eagle XG);
  - fused silica or quartz;
  - a compound semiconductor, lithium niobate or tantalate, or another crystal.

  The checks then use your answer in every project. A note that rests on your answer says "From a setting made in this app."
- **Answers only fill in what the app doesn't know.** They never take away what it reads: Ti stays a metal and Au stays a fast-diffusing metal, whatever the answer. An answer counts wherever the material is written with words that only describe it ("Evaporated Se", "Se film").
  - **Wafers.** For a film the app knows used as a wafer (an SiO2 wafer could be fused silica), the question is **What kind of wafer is SiO2?** The answer counts only for wafers of it, so SiO2 films stay as they are.
- **Compound semiconductors and lithium niobate or tantalate are not CMOS-clean.** A wafer that carries one (GaAs, InP, LiNbO3, by name or by your answer) now gets **Not allowed** at the tools that take CMOS-clean wafers only: the furnace tubes, PFC Bench 01, Acid Bench 02 and P5000 RIE chamber C. This is general practice, and the note says so. In 1.5.0 such wafers were stopped only where a tool lists the substrates it takes.
- **Settings → Materials** shows what the checks make of each material and how many they don't know. Tap one they don't know, or one you answered, to say or change what it is. Removing a material also takes its answer back.
- **Answers sync** with your other devices and travel in backups; the newer answer wins. Imports and syncs say how many answers changed. 1.5.0 devices keep syncing and ignore the answers.
- **The checks know more names:**
  - more metals and alloys: ruthenium, rhodium, osmium, manganese, gallium, hafnium, zirconium, scandium, yttrium, lanthanum, erbium, gadolinium, rhenium, antimony, bismuth and cadmium (by name or formula), Pb, and AlCu, AuGe, TaN and other common alloys;
  - more polymers: BARC, Teflon, Kapton, and polymers by chemical name ("Poly(methyl methacrylate)");
  - spelled-out compound semiconductors ("Gallium nitride", "Indium phosphide");
  - the oxides, nitrides and carbon the LNF lists.

  Every LNF material is known except selenium, which you decide.
- **PFC Bench 01 and RCA Bench 81** also bar a material you say is not CMOS-clean, as their LNF rules ("CMOS-clean materials only", "Only Si, fused silica and glass") say. RCA Bench 81 also bars lithium niobate and tantalate.
- **Fixes:**
  - The S5T2 "Fluorocarbon Removal" recipe no longer counts as leaving fluorocarbon on the wafers.
  - The doped-oxide films PSG and BPSG are no longer read as glass when spelled out: "Phosphosilicate glass", "Spin-on glass" and "Spin on glass".
  - A resist listed after a metal ("Cr/AZ 1518") now counts as a resist too.
  - A silicon dopant in a name (boron, phosphorus, arsenic or antimony: "Sb-doped Si", "Si:B") is not a film. Any other dopant counts as what it is: "Au-doped Si", "Al-doped Si" and "Er-doped glass" carry metal.
  - A metal named with the wafer it is on ("Aluminum on thermal oxide wafer", "Titanium on hafnia") counts as metal.
  - "Silicon dioxide" written out is asked about as a wafer, as SiO2 is, instead of being read as silicon.
  - A strip no longer takes a polymer wafer's own material away (a Kapton wafer stays Kapton).
  - A double tap no longer picks or checks anything you did not see. A sheet ignores taps in its first half second, and an answer ignores the tap right after it.
- **Under the hood.** Settings gain `materialKinds`; sync files and backups carry it. After updating, each device reads every other device's sync file once more. New tests cover the names the checks know, the new notes, answers and how they merge. The smoke test answers "What is Zeonor?" for a new substrate.

## M9: Wafer and mask types, bonding, and plan checks

Version 1.5.0.

- **Wafer types.** Say what a project's wafers are: material, size (2 in to 200 mm, pieces), thickness and tolerance, orientation, cut, polish, doping and dopant, resistivity, grade, and the films already on them.
  - **Settings → Wafer types** keeps your own types and lists the **LNF store's** 13 single wafers and mask plates, with the store's own names and descriptions and the prices seen on Oct 22, 2026. **Copy to your types** makes an editable copy.
  - **Add wafers** asks how many and of which type, in one sheet. Four store wafers in a new project take four taps and become W1–W4.
  - Each wafer's type is one button on its row. Choose a type for one wafer or for all those without one, or edit the details and save them as a new type.
  - Each wafer keeps its own copy of its type, so editing a type later never changes a project's history.
- **Masks are wafers of kind mask.** They are numbered M1, M2, use plate sizes (4 to 7 in) and have mask fields (coating, resist on the blank, polarity, design and layer). Runs and checks leave them out of "every wafer" unless a step names them.
- **Bonding.** A step on a bonder bonds wafers into stacks, and one on the Sample mounting station mounts them on a carrier (a temporary bond): **Pair them** proposes pairs in one tap, or tap the wafers of each stack yourself, and choose the bond method once. After the bond, a step or run that names one wafer takes the whole stack (tapping one wafer of a stack in a run picks the stack). A later step can debond; a debond in a solvent takes the mount's adhesive off, a dry one leaves it for a later clean.
- **Plan checks.** Each step is checked against what its tool takes: wafer size and pieces (with carriers), thickness (a stack's adds up), substrate, the materials on the wafers, how clean they are (metal on a wafer, a step on an evaporator, sputter or plating tool even for a dielectric, dicing, and metals-class and non-CMOS solvent benches leave wafers out of CMOS-clean tools for good), the last wet bench before the PFC clean, and KOH waiting to be cleaned off.
  - The facts come from the **LNF wiki notes** the app already ships (the furnace tubes' sizes, silicon only and the PFC Bench 01 clean right before; PFC Bench 01 taking no wafers from wet benches other than Acid 02 or RCA 81; KOH cleaning in order, Piranha and SC2 at Acid 92 then RCA at RCA 81, and a KOH developer at Base Bench 63 keeping wafers out of clean tools; carriers on the P5000 PECVD, Synapse and Pegasus 6; mask plates on the mask maker and mask bench) and from **general practice** (evaporator, sputter and plating tools; the bond methods; a mask plate wider than the wafer). Every note says which, and the LNF's rules and the tool engineer come first.
  - Notes show on each plan step while you edit, on the project page (the next step's card, badges on the plan, the step's sheet), on **Log run** under the project's step, and in the traveler export. Each starts with **Not allowed** or **Check** and ends with what it rests on.
  - **Mark as checked** quiets a note; **Add the PFC Bench 01 clean before this step** fixes the most common one in a tap.
  - Nothing unknown raises a note, and notes never stop you saving.
- **Log run follows the step.** **Log this step** and the step menu move a new run to the chosen step the same way: its wafers while they are still the previous step's, its recipe while it is still the previous step's.
- **What each tool takes.** **Settings → Tools → a tool → Compatibility** shows what the checks know about the tool and lets you change the sizes (your choice replaces the LNF notes' size limits), pieces, thickest wafer or stack, mask plates and materials not allowed; **Reset** undoes it.
- **No run costs yet.** They come once the LNF wiki's tool pricing is read; the store prices show on the wafer types.
- **Under the hood.** IndexedDB version 4 (the `wafers` store). The record format is still 1, so 1.4 devices keep syncing: checked against the 1.4.1 code both ways, they refuse nothing and keep every new field. New tests cover wafer specs and material classes, the LNF store list, the checks on real LNF tools (sizes, carriers, cleanliness, KOH, bonds, masks), copies and stacks, and sync of the new store; the smoke test adds store wafers to a project and fixes a check note.

## 1.4.1: Tool photos

- **Each tool's photo from the LNF wiki comes with the app.**
  - 123 of the 127 tools have one.
  - **Log run** and **Run detail** show it on the tool card; tap it to see it larger.
  - The tool's page shows it at the top.
  - The four tools without a photo on the wiki keep their category icon.
- **The app still never contacts the wiki.** The photos were fetched once, by hand, for this release, and they work offline.
- **Small download.** The photos add 2.5 MB. Later updates reuse them instead of downloading them again.
- **For maintainers:** `npm run photos` fetches photos for new tools. It stops if the wiki refuses (DECISIONS.md 110).
- The photos belong to the University of Michigan and are not covered by the app's license.

## M8: Projects in folders, runs with steps, and the alpha-test fixes

Version 1.4.0.

- **Projects follow wafers from start to finish.** They are optional: runs logged without one work as before.
  - A project has a name, goal, substrate, start date, notes, its wafers (W1, W2…, each in process, done or scrapped, with a note) and, if you like, a plan of steps, each with a tool, template and recipe.
  - **Log this step** opens Log run on the step's tool with the project, its wafers in process and the step chosen. Any run can join projects in its **Project** section, with the wafers it processed and the planned step it carries out. One run can carry wafers of several projects, and several projects can run at once.
  - A step is done when a complete run is linked to it (or you mark it done), in progress while a draft or open run is. The project page shows the progress, the next step, the plan and the **traveler**: every run its wafers went through, in order, for all wafers or one.
  - **Export the traveler** as PDF or Excel. Home lists your active projects with their next step; History filters by project; run rows show their projects; the backup, sync and every export include projects.
- **Folders and subfolders.** Projects live in folders, and folders in folders. Create, rename, move and delete folders; deleting one either moves what it holds up a level (renaming a folder whose name is already taken there) or deletes it too, with Undo. **Select** moves or deletes several projects at once. Folders sync, and the tree stays sound when two devices move folders at the same time.
- **Copy and delete projects.** **Copy project** opens a New project form with the same plan and wafer labels and nothing done yet, for the next batch. Delete has Undo and leaves the runs in place.
- **Runs with several steps.** **Add a step** for a breakthrough, an over-etch or the layers of a stack, each with its own values. The main step (★) is the one Lookup compares. A multi-step LNF recipe fills every step.
- **The Plasmatherm 790's second chamber.** A **PECVD film (right chamber)** template (seed version 3), with the wiki's seven P790 deposition recipes and their expected rates, index and stress. Every 790 recipe now names its process, so the RIE form lists only the etch recipes and the PECVD form only the deposition ones, whichever template is the tool's default.
- **Countdown timer.** **Count down** runs from the time in the form, keeps the screen on, and buzzes and beeps at zero, then counts the overtime. The alarm goes off on any screen of the app, also after a reload. **Stop** fills the main step's time with the time that passed.
- **Measurements.** **Paste values** fills the sites from the metrology tool's software or a spreadsheet: a column, a row, "site = value" pairs or CSV lines; digits inside words and dates in a header are skipped. The metrology tool starts as the one you used last for that kind of measurement (or one that measures it) and folds to one line with Change.
- **Result against an input.** Results and Tool detail plot the result against each input that varies across your runs (etch rate against ICP power), with a fitted line.
- **My tools.** Pick your tools in Settings → My tools or with ☆ on a tool's card. Tool pickers show them, and tools you used in the last two months, first, with all 127 one tap away.
- **From the alpha test:**
  - A recipe sets the material only when the form has none and the recipe's film matches one listed material; the message says when it does. Before, a recipe naming "SiO2" moved a run away from "SiO2 (thermal)", and Lookup's Same material rule missed it.
  - In the material picker, "gold" now offers **Use Au** first, not a new material; **Clear** is a link of its own.
  - Mark complete warns when the main result is missing, and says why. When only the run's time keeps the rate from being worked out, a time box appears with the results.
  - Run detail shows what the run needs next first, and an empty Results section is one short card. Open runs say what each run waits for.
  - Tool event: what happened comes first, with no preset type, and the tool folds to one line once chosen.
  - "Unsaved run" appears only for a form you changed, and names its tool.
  - Gas lines a run does not use fold behind one row of buttons.
  - Name-only recipes are listed last, with a badge; the recipe's Use button stays in reach at the bottom of the sheet.
  - The ± button appears only on fields that can be negative.
  - Results: the chart sits under the summary (beside it on a wide screen), joins only exact matches and fades runs beyond the closest few. A suggested time outside its range no longer says "range"; the subtitle says "the closest 5 of 12 runs".
  - Look up no longer says "same material" when no material is set.
  - The tool card's name opens the tool's page; Tool detail shows its charts first and its runs' key settings.
  - History: search on top, filters folded into one line that says which are set, and a sortable table on a wide screen. Forms use two columns there too.
  - Section titles in sentence case; short screen titles; the app bar shows icons only on narrow phones; "just now" instead of "now ago".
  - Lookup tuning moved under Settings → Advanced; About links to the source code.
  - Windows install steps no longer mention npm.
- **Checked before release.** Seven reviewers read every change and skeptics confirmed each problem they found; all are fixed. Three more reviewers then checked the fixes, and what they found is fixed too. Among them:
  - Saving the project editor no longer undoes step marks, a pause or a move made since the editor opened, and unsaved edits restored after such a change keep it.
  - A run's own steps stay when a one-step recipe fills it.
  - "Log this step" no longer leaves its project link in a form you only looked at.
  - The 1.3 → 1.4 upgrade no longer brings back materials you removed. Sync reads other devices' files once more, so their projects arrive.
  - Back works at once after saving or cancelling a form.
  - The traveler workbook has the conditions, substrate, mask and shared projects that the PDF shows.
  - Keyboard and screen-reader focus stays put when a form redraws.
- **Under the hood.** IndexedDB version 3 (projects and folders stores); the record format is still 1, so 1.3 and 1.4 devices keep syncing. New tests cover projects, folders, folder deletion and its Undo, run steps, measurements and pasting, the new data in backups and sync, the router's Back handling, and a smoke-test journey that logs a run into a project and files the project in a folder.

## M7: An "i" button on every field

Version 1.3.0.

- **Every field label has an "i" beside it.** Tap it to open a short note under the label, and tap again to close it.
  - **Template fields** (inputs, conditions and results) say what the setting or result is and, where there is a usual trend, what raising it tends to do. A key gets the meaning its template gives it: "pressure" is the chamber pressure on a plasma etcher, the XeF2 pressure on the Xactix and the down force on the CMP. Gases say what they do in that process: NF3 cleans the chamber of a PECVD but etches on a plasma etcher.
  - Each note ends with how Lookup treats the field, worked out from the template, for example "a difference of 5 mTorr adds 1 to the distance", "Lookup leaves it out", or the formula of a derived result. It stays right when you edit a template.
  - **Lookup tuning** (half-life, event penalty, top K): what each one does, and what raising or lowering it changes.
  - Look up's match rules, the template and field editors (weight, spread hint, must match exactly, chemistry), measurements, tool events, tool settings, sync, backup, export and the History filters have notes too.
  - The notes are general process knowledge, not recipe advice: the tool's documentation and its engineer come first.
  - Notes that only repeated a visible hint moved behind the "i": primary output, process type, role and spread hint in the template editor.
  - `test/field-help.test.mjs` checks that every field of every seeded template and every LNF gas has its own note, that a key gets its template's meaning, the Lookup line, and that every note a screen asks for exists. The smoke test checks that every visible field label on the main screens has its button, and that the button opens and closes its note.
- **No tool photos, and no automatic contact with the LNF wiki.**
  - The LNF wiki has had security problems, so the app no longer loads anything from it. A tool's card shows its category icon.
  - **?** still opens the tool's wiki page, with its photo, in your browser. If the wiki asks for a UMich login or the UMich network, you sign in there.
  - Wiki information reaches the app only through releases.
  - The photo download script is gone. The browser tests (`npm run smoke` and the desktop smoke test) cannot reach the wiki, and the smoke test fails if a page tries.

## M6: LNF recipes, tool photos, export everything, and updates that reach the phones

Version 1.2.0.

- **LNF recipes.** 599 recipes for 95 tools, read from the LNF wiki's process pages and from the sheets, documents and PDFs that its tool pages embed or link.
  - **Log run** and **Run detail** have a Recipe section above Inputs. **LNF recipes (n)** lists the tool's recipes, with search. A recipe shows its steps, which values fill the form, its results on the wiki, notes and its source.
  - **Use recipe** fills the main step (or the step you choose), names the recipe and, when the recipe names one film, sets the material. Gases the recipe does not use are cleared. **Undo** puts the form back.
  - **Look up:** **LNF recipes → Fill planned inputs** fills the inputs. Results show what the wiki says the recipe gives, next to the estimate from your runs and never mixed into it. **Log this run** keeps the recipe name.
  - **Tool detail** lists the tool's recipes; **Log run with this recipe** opens a prefilled form.
  - Recipes ship with the app: no database change, and nothing to back up or sync. A run stores the recipe name, as before.
  - Wiki pages were read from the Internet Archive's latest copies, because the wiki refused connections from off campus on 2026-10-21. The sheets and documents they embed were read live. Each recipe shows its source and date. Sources that need a UMich login are not included (see DECISIONS.md).
  - `test/recipes.test.mjs` checks the fill rules and every shipped recipe against its tool's template. The smoke test uses a recipe.
- **Tool photos and the LNF wiki in one place.**
  - Log run, Run detail and Tool detail open with the tool's card: its photo from the LNF wiki, its name, and **?**.
  - **?** gathers the tool's wiki page, its process page, the SOPs and other documents its page links, and its recipes.
  - The app ships the photos it could read (12 so far). The others load from the wiki when it is reachable, and a category icon stands in otherwise. `npm run photos`, run on the UMich network, ships the rest.
- **Export everything.** Settings → Backup and data (and a shortcut on History) exports every run, with its parameters, results and measurements, in one file (the Excel and PDF files also hold the tool events):
  - **Excel**: a workbook with all runs, one sheet per tool with named columns, the measurements and the tool events. Times are real Excel dates.
  - **CSV**: one table with a row per run.
  - **PDF**: a report to read or print, tool by tool and run by run.
  - All three are built on the device with no libraries, and share or download like the other exports.
- **A friendlier look.** A colour and icon for each tool category, on tool tiles, run rows and tool cards (both themes meet WCAG AA). A greeting on Home with this week's run count. Screens and sheets ease in, unless the system asks for reduced motion.
- **Updates reach installed apps reliably.** The app now notices a new version that started installing before the page was ready. It shows "Update available — Reload" again when it comes back to the foreground if another message pushed it away.
- **Why 1.1 never reached the phones.** Version 1.1 was built in a Synology Drive copy of the project. That copy has no `.git` folder, so 1.1 was never pushed and GitHub Pages kept serving 1.0. DEPLOY.md now has a section on what to check when the phones do not see an update.

## M5: Sync through GitHub, and the LNF equipment list

Version 1.1.0.

- **Sync** through a private GitHub repository.
  - **Settings → Sync** takes the repository, a fine-grained token and a device name, then checks them with GitHub.
  - **Sync now** sits on Home and in Settings. Each device writes one compressed file; Sync merges everyone else's: the newer edit wins, deletions carry over, nothing is wiped, and ties go to the higher device id.
  - It refuses public repositories. The token stays on the device. Files it cannot read are reported and skipped.
  - Photos stay on the device that took them, and a run says how many are elsewhere.
  - Nine sync tests run against a fake GitHub. The screens were checked in a browser against the same fake: a bad token, connecting, a first sync and a merge.
- **LNF equipment list** (seed version 2).
  - 127 tools from the LNF wiki, each with the generic template for its type and the gas lines its wiki page lists.
  - The tool picker adds category chips once there are more than 12 tools. Settings → Tools groups tools by category.
- **Materials.**
  - Every material the wiki lists as supported (106 names for 244 wiki entries), plus LiNbO3 (bulk).
  - The picker's More… sheet searches them, including the wiki's other names ("gold" finds Au), and adds new ones.
  - Materials have their own Settings page with the same search.
- **Existing installs upgrade once.** The LNF tools and materials are added, nothing is overwritten, and example tools that were never used or edited are archived.

## Installers and apps (after M4)

- **Windows.**
  - `npm run build:windows` builds `dist/LNF-Run-Log-Setup-<version>.exe` (about 1.4 MB): a per-user installer with no admin rights, Start menu and Desktop shortcuts, an Installed apps entry, update in place, and an uninstall that keeps your data unless asked.
  - The app is a native WebView2 window that bundles the app files. Its data lives in `%LOCALAPPDATA%\LNF Run Log`.
  - Verified end to end on this PC; `--smoke` repeats that check.
- **macOS.** `desktop/macos/build-macos.sh` builds a universal `LNF Run Log.app` (WKWebView, `lnfrunlog://app` scheme) and a drag-to-install DMG. Untested until its first build on a Mac.
- **Phones.** The installed web app, from the published HTTPS address.
  - **Settings → Install on your devices** shows the address as a QR code (a zero-dependency encoder, verified with OpenCV and ZXing) and the steps for iPhone (iOS 26 and 27), Android, Windows and Mac.
  - Publishing steps with GitHub Desktop are in `docs/DEPLOY.md`.
- **License.** GNU AGPL-3.0-or-later.
- **Sync design notes.** `docs/SYNC.md`.

## M4: History and data safety

- **History.** Filter by tool, template, material, status and date range (local days, inclusive), plus a keyword search over notes, recipe and tags. Filters are remembered, and `?tool=` presets the tool. Results show 50 at a time.
- **Tool detail.** Tool facts, the event timeline, a chart of each template's primary output over time with event markers, recent runs, and a "Log run" bar.
- **Backup.**
  - A JSON backup (`lnf-runlog-backup-YYYY-MM-DD.json`), photos optional with a size estimate, assembled one photo at a time.
  - Two-step export: prepare, then **Share…** (system share sheet) or **Download**.
  - CSV export: `runs.csv` with `p.*`/`r.*` columns, plus `measurements.csv` and `events.csv`, with a UTF-8 BOM and a guard against spreadsheet formula injection.
- **Merge import.** It validates the file, migrates, normalises, keeps the newer `updatedAt` per record by id, respects tombstones, never deletes, writes in one transaction, and reports added, updated, skipped and invalid counts. **Erase all data** asks you to type ERASE.
- **Storage status:** usage, quota, persisted, photo usage, and a request for persistent storage.
- **Quality checks.**
  - The browser smoke test (`npm run smoke`): load, log, measure, look up, export with a real download, offline reload, an every-control-is-labelled check, and a page-error check.
  - A WCAG AA contrast test for both themes; it found and fixed one dark-mode problem.
  - Router and helper tests.

## M3: Lookup

- **Core.** `core/similarity.js` (filters, distance, spreads, weights, ranking, extrapolation, relax counts), `core/summary.js` (sensitivity, estimates, average, headline, trend, last event, suggested time, confidence) and `core/summary-text.js` (sentences).
  - All Section 11 cases pass exactly.
  - Edge cases are covered: no candidates, a single candidate, missing fields, spread fallbacks, non-ASCII materials, siblings, events, half-life override, trends, determinism.
- **Look up.**
  - The tool → template → planned inputs flow: every field optional with Clear, prefilled from the last run.
  - Material and target thickness.
  - The Strict chemistry, Same material and Include siblings toggles.
- **Results.**
  - A summary card: headline, range, confidence with reasons, warnings, suggested time with range, sentences.
  - An output switcher.
  - Ranked matches with signed differences, d and w, and the "Exact match" and "Before last clean" flags.
  - An SVG chart of the output over time with event markers; points before an event are hollow.
  - Relax suggestions when nothing matches.
  - **Log this run**, which prefills the form and fills in the suggested time.
- The real UI reproduces the worked example. Case 4 gives 85 nm/min (exact match), 5:53 suggested, A and C before the clean; Case 3 gives 103 nm/min with the warning; Case 5 offers +3 runs.
- `docs/ALGORITHM.md` describes every rule and constant.

## M2: Capture

- **Log run.** Tool tiles (recent first, with search), then template (skipped when a tool has one), then the form.
  - The form is prefilled from the last run with the same tool and template, with a "Copied from Oct 6 run" chip and Clear.
  - It has steppers with hold-to-repeat and an mm:ss duration input.
  - Material, substrate and mask pickers list recent choices first and can add a new material.
  - It also has recipe, target thickness, context fields, optional results, camera photos (resized on the device), notes with dictation and tags.
  - An optional run timer fills the time field.
  - Save as Open, or Save complete once results exist.
  - The form autosaves to IndexedDB. If you start another form, a changed unsaved form is kept as a draft run and never lost.
- **Quick capture.** Tool, photo and note, saved as a draft run.
- **Open runs.** Drafts and open runs, oldest first with their age, plus a Resume banner for an unsaved form.
- **Run detail.** It autosaves edits and recomputes derived values.
  - Results: derived values are marked and read-only until Edit; typed values win; "Use derived" goes back.
  - Also: the measurement list, inputs, sample, conditions, photos, notes, values from removed fields, and times.
  - Actions: Measure, Mark complete or Reopen, Mark open, Duplicate as new run, Delete with Undo.
- **Measurement entry.**
  - Defaults:
    - the last-used metrology tool;
    - Pre until a pre measurement exists, then Post;
    - the same sites as the last measurement.
  - Kind, material and unit (Å and µm converted to nm on save).
  - Site presets: Center, Center + 4 edge, 5-point, 9-point and Custom.
  - One stepper per point, with Enter moving to the next.
  - Live mean, range and uniformity.
  - Saving recomputes derived outputs and reports the new primary output.
- **Tool events.** Tool, type, Major (defaulted by type), date and time (default now) and notes. Edit, and delete with Undo.
- **Derived-value core.** Tests cover Section 11 Case 6 and the edge cases (missing pre, zero, negative or missing time, empty points, zero mean, mask not etched, unit conversion, manual overrides, stale values).

## M1: Shell

- Repo skeleton, `package.json` (scripts only, no dependencies), `.gitignore`, `jsconfig.json` for editor type checks.
- `scripts/check-line-limits.mjs`: fails above 1000 lines and lists files over 600. It runs in `npm test` and CI.
- `serve.mjs`: zero-dependency static dev server with path-traversal protection and a `--lan` option.
- PWA shell:
  - `index.html` with the iOS and Android meta tags
  - the manifest
  - the versioned app-shell service worker, with an update toast that waits for the user
  - icons drawn and PNG-encoded by `scripts/make-icons.mjs`
  - `scripts/bump-version.mjs`
- Hash router with lazy view modules, an in-app back stack and guards against stale renders.
- IndexedDB layer:
  - a promise wrapper with strict-durability writes
  - schema with migrations and validators
  - stamping (ids, `updatedAt` always moving forward, author and device)
  - soft delete, settings, and autosaved form drafts
- Seed data: 12 generic "(example)" tools, 10 templates across every category, and the materials list. Fixed ids for safe merges.
- Settings:
  - name and device
  - tools: add, edit, archive, half-life override
  - template editor: fields, spec properties, reorder, derived outputs, preview, key locking
  - materials, lookup tuning with reset, theme, version and update check
- UI kit:
  - `h()` builder
  - steppers with hold-to-repeat
  - mm:ss duration input
  - segmented choices, switches, toasts with Undo, confirm dialog, bottom sheet, list rows
  - light and dark themes, both meeting AA contrast
- Tests: line limits, schema and seed, record stamping, ids, time, format, PWA shell assets, code conventions.
- Docs: `DATA-MODEL.md`, `DECISIONS.md`, `DEPLOY.md`. CI and Pages workflows.
