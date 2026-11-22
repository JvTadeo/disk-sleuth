# Architecture and internals

How the app is built, and why. For setup and usage, see the [README](../README.md).

## Scanner benchmark

```bash
npm run bench -- C:\
npm run bench -- C:\ --workers 64 --stat 16 --pool 64
npm run bench -- C:\ --json > bench.json
```

`--workers` sets folders read in parallel, `--stat` the file lookups per folder and `--pool` the libuv thread pool size.
It runs the same scanner the app uses and prints duration, files per second, peak memory, hard links and
junctions skipped, inaccessible folders and the largest items. Press Ctrl+C to cancel.
Run it from an elevated terminal to include folders that need administrator rights.

Roadmap targets: 1M files in under 90 s on an SSD, and under 400 MB of memory with 1M files.

## Project structure

```text
src/
  main/        main process: window, IPC, settings, drives, scanner host, program detector,
               scan cache, elevation, reports
  preload/     typed bridge exposed to the window as window.api
  scanner/     scan engine: compact tree + parallel walker; worker.ts runs in a utilityProcess
  shared/      IPC and scanner contracts (types shared by every side)
  renderer/    React: pages, shadcn components, styles
scripts/
  bench.ts     scanner benchmark CLI
tests/
  classify.test.ts       program classifier tests
  report.test.ts         report builder tests
  scanner.test.ts        categories, comparison, duplicates, cache round-trip
  fixtures/inventory.ts  sample Windows inventory
```

### How the scanner works

- **Own process:** the scan runs in an Electron `utilityProcess`, so the window never stalls. The tree stays there
  and the window asks for one folder level at a time (at most 500 entries; the rest is grouped).
- **Compact tree:** nodes are indexes into parallel typed arrays (~33 bytes each plus the name) instead of one
  object per file, which keeps memory low and the garbage collector quiet.
- **Parallel walk:** 32 folder workers, each stating files 16 at a time, with `UV_THREADPOOL_SIZE=32`.
  Tuned on a 1.2M-file C: drive: 52 s (23k files/s), 353 MB peak memory.
- **Correct totals:** symlinks and junctions are never followed (some loop forever), hard-linked files count once
  (otherwise `C:\Windows\WinSxS` looks far bigger), sizes use "size on disk", and OneDrive placeholders are
  counted at their real local size.

- **Typed IPC:** channels and payload types live in `src/shared/ipc.ts`. If one side changes, the other stops compiling.
- **Security:** the window runs with `sandbox` and `contextIsolation`, without Node. It can only reach `window.api`,
  and the main process validates every input.
- **Settings:** stored in `%APPDATA%\Analisador de Disco\settings.json`.

## Performance decisions

- **Small renderer:** under 100 KB of JS (gzip) in total. Every page except the Overview is lazy-loaded.
- **Icons:** each icon is imported from `@remixicon/react` by name, so only the ones in use get bundled.
- **shadcn/ui:** components (Button, Card, Badge, Select) are copied into `src/renderer/src/components/ui`. Add more with
  `npx shadcn@latest add <component>`.
- **No white flash:** the window is shown only when ready, with the theme's background color already set.
- **Lean installer:** Vite bundles every library, so the packaged app ships without `node_modules`.
- **Fonts:** Geist and Geist Mono are bundled; nothing is fetched at runtime.

## Themes

Three options under **Configurações › Aparência** (Settings › Appearance): light, dark and Windows default.
In Windows default mode the app follows the system theme live.

### Disk page

- **Treemap (canvas):** two levels deep, squarified. The base layer is drawn only when the data, size or theme
  change; hover and selection live on a second canvas, so moving the mouse never repaints the map.
  The scanner sends at most 3,000 cells (entries under 0.01% of the area are grouped).
  Worst case measured: 3,001 cells drawn in 8.9 ms with software rendering, hover at 60 fps.
- **Folder tree:** virtualized with `@tanstack/react-virtual`; children load lazily, one level at a time.
- **Largest files:** the 100 largest files of the whole scan, found in one pass over the tree.
- **Actions:** open in Explorer, copy path, move to the Recycle Bin. The main process resolves paths from node
  ids (the window never sends paths), asks for confirmation in a native dialog (Cancel is the default) and warns
  when the item is inside Windows, Program Files or ProgramData. Totals update without rescanning.
- **Keyboard:** Backspace goes up one level; Delete moves the selection to the Recycle Bin; Shift+Delete deletes it
  permanently (after a stronger confirmation). Drive roots, Windows, Program Files, ProgramData and the user
  profile itself can never be removed from the app.
- **Transitions:** pages and tabs fade in with a slight rise (CSS only, opacity + transform), disabled when Windows
  animations are turned off (`prefers-reduced-motion`).

## Program detector

Lives in `src/main/detector/`. It runs in the main process: the work is a single PowerShell call plus shallow folder
listings (all async), and the classifier handles a few hundred items in milliseconds.

1. **Collect** (`collect.ts`): one Windows PowerShell call, sent with `-EncodedCommand`, returns the three Uninstall
   registry views (HKLM 64-bit, HKLM 32-bit, HKCU), the user's Store packages and every Start menu shortcut target as
   JSON. In parallel, Node lists candidate folders: Program Files (both), `AppData\Local\Programs`, the top level of each
   drive, and AppData/ProgramData, looking for executables up to two levels down.
2. **Classify** (`classify.ts`, pure and unit-tested): a folder belongs to a program when the program's install
   location or executables are inside it, when one of its shortcuts points into it, or when the names match
   (`names.ts` normalizes "7-Zip 24.08 (x64)" to "7zip"). Then:
   - **Registrado:** registry entry or Store package. Entries hidden by Windows (system components) only show on request.
   - **Não registrado:** a folder with executables that no registry entry claims (portable or copied installs).
   - **Órfão:** a registry entry whose folder *and* uninstaller are gone (high confidence); a program folder with no
     executables and no owner, or an unclaimed AppData/ProgramData folder over 100 MB (both "likely").
   Folders that ship with Windows, drivers and developer tools are on ignore lists, and user folders at a drive's root
   without executables are never reported.
3. **Sizes** come from the current disk scan when there is one (exact); otherwise from the registry estimate (shown
   with "~"). Data leftovers need a scan, since they are judged by size.

Actions: **Desinstalar** runs the program's registered uninstaller through `cmd /c start` (so UAC prompts work), or
opens Windows Settings for Store apps. **Mover para a Lixeira** is offered only for unregistered and orphaned folders.
Both ask for confirmation in a native dialog first, and the window only ever sends program ids.

**Debugging a wrong classification:** `DISK_ANALYZER_INVENTORY=<file.json>` makes the detector replay a saved
`{ inventory, areas }` instead of reading Windows (see `tests/fixtures/inventory.ts` for the shape).

## Scan cache, administrator mode and reports

- **Scan cache** (`src/main/cache.ts`): one saved scan per drive. Selecting a drive in the sidebar opens the Disk
  page with that drive's saved scan (or a button to scan it). After every complete scan the scanner process writes
  the tree as one binary file (raw typed arrays + names, ~55 bytes per node, written to a temp file and renamed, so a crash never
  leaves half a cache), plus a small JSON summary. At startup the summary is read synchronously, so the Overview
  shows results immediately, and the tree loads in the background in the scanner process; queries sent meanwhile
  wait for it. Moving items to the Recycle Bin re-saves it a few seconds later. Settings › Varreduras salvas lists them
  and can delete them. `active.json` remembers which drive to show at startup. Files live in `%APPDATA%\Analisador de Disco\scan-cache\`.
- **Administrator mode** (`src/main/elevation.ts`): "Escanear como admin" restarts the app through UAC with
  `Start-Process -Verb RunAs`, passing `--relaunch --scan-root=<drive>`. The new instance waits for the old one to
  release the single-instance lock, then starts scanning right away, now including protected folders. Admin rights
  are detected with `net session`.
- **Reports** (`src/main/report.ts`): Overview › Exportar relatório saves either a self-contained HTML page
  (summary, largest items and files, programs that need attention, all programs; prints cleanly) or a CSV for Excel
  (one flat table, `;` separators and a UTF-8 BOM for Brazilian-locale Excel, formula-like values neutralized).

## File types, comparison, duplicates and context menus

- **File types** (`src/scanner/categories.ts`): every file gets a category from its extension (video, image, audio,
  document, archive, program, game data, development, system, other). Each folder keeps bytes per category in a
  Float32 row (~40 bytes per folder), built bottom-up after the scan and kept right when items are removed. The
  treemap can color by folder or by file type (dominant category per cell); the Overview shows the breakdown of the
  whole drive and the details panel the breakdown of a folder.
- **Comparison** (`src/scanner/snapshot.ts`): each saved scan also writes a light snapshot (all folders + files of
  10 MB or more). When the same drive is scanned again, the new tree is compared with it before the snapshot is
  replaced. The walk only enters branches that changed by 100 MB or more and reports the deepest such items, so the
  Overview lists "Downloads +12 GB" rather than every ancestor. Clicking a change opens it on the Disk page.
- **Duplicates** (`src/scanner/duplicates.ts`): files of the same size are compared by an MD5 of their first and last
  64 KB, then by an MD5 of the whole file, biggest first, 4 at a time, with progress and cancel (partial results are
  kept). Hard links are already counted once, so they never show up as copies. Disk › Duplicados.
- **Right-click menus**: native Windows menus on the folder tree, treemap, largest files, duplicates and programs.
  The main process builds the menu (with only the actions that make sense for that item) and the window performs the
  choice. Folders also get **Esvaziar pasta…**: removes everything inside (read from disk at that moment, so items
  newer than the scan are included) and keeps the folder; the confirmation offers Recycle Bin or permanent deletion,
  items in use are skipped and counted.
- **Program icons**: taken from each program's executable with `app.getFileIcon`, cached for the session.

The saved-scan format changed (version 2): scans saved by earlier versions are discarded and need one new scan.

## Distribution

`npm run dist:win` (run it on Windows) writes two files to `release/`:

- **`analisador-de-disco-<version>-instalador.exe`**: an NSIS installer in Brazilian Portuguese. It installs per
  user by default (no administrator rights needed), lets you pick the folder, creates Start menu and desktop
  shortcuts, and registers an uninstaller in "Add or remove programs". Uninstalling keeps saved scans and settings.
- **`analisador-de-disco-<version>-portatil.exe`**: a single .exe that runs without installing. It keeps settings
  and saved scans in an `Analisador de Disco - dados` folder next to the .exe (`src/main/portable.ts`); if that
  location is read-only it falls back to `%APPDATA%`. Starting is a little slower because the .exe unpacks itself
  to a temp folder each time.

Administrator mode works in both: the portable build relaunches the original .exe and passes its data folder along,
because an elevated process starts with a fresh environment.

The builds are not code-signed, so Windows SmartScreen shows "Windows protected your PC" (unknown publisher) the first
time. Click **More info** then **Run anyway**. Removing that warning needs a code-signing certificate.

Building on Linux or macOS needs `wine` for the Windows-specific steps (installer, icon embedding).

### App icon

A small treemap on a dark tile. The sources are in `resources/`: `icon.svg` (large sizes), `icon-small.svg` (a
simplified drawing for 24 px and below), `icon.png` (512 px) and `icon.ico` (16 to 256 px). The title bar draws the
same mark (`components/layout/AppLogo.tsx`).
