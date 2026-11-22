<p align="center">
  <img src="resources/icon.png" width="96" height="96" alt="App icon: a small treemap on a dark tile">
</p>

<h1 align="center">Analisador de Disco</h1>

<p align="center">
  A fast disk usage analyzer for Windows that also finds the programs Windows doesn't list.
</p>

<p align="center">
  <img alt="Platform: Windows 10/11" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4">
  <a href="https://github.com/JvTadeo/disk-sleuth/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/JvTadeo/disk-sleuth?color=18181b"></a>
  <a href="https://github.com/JvTadeo/disk-sleuth/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/JvTadeo/disk-sleuth/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-45-47848f">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
</p>

<!-- Add a screenshot: save it as docs/screenshot.png and uncomment the line below. -->
<!-- <p align="center"><img src="docs/screenshot.png" alt="Disk page with the treemap and folder tree" width="900"></p> -->

---

Windows only lists a program under **Settings › Apps** ("Add or remove programs") if its installer registered it.
Portable apps, installers that skip that step, per-user installs in `AppData` and leftovers from old uninstalls never
show up there, but they still take up space. **Analisador de Disco** maps your whole drive and cross-checks the
registry, the Microsoft Store, Start menu shortcuts and program folders to find them.

> The interface is in Brazilian Portuguese. The code, comments and docs are in English.

## Features

**See what is using your disk**
- Interactive **treemap** drawn on canvas, colored by folder or by file type (video, images, games, development…)
- Virtualized **folder tree** that stays smooth with millions of files
- The **100 largest files** on the drive
- **Duplicate finder**: groups identical files by size and content hash, biggest savings first
- **Compare scans**: shows what grew since the last scan ("Downloads +12 GB")

**Find hidden programs**
- Every program gets one of three states:
  - **Registrado**: listed by Windows
  - **Não registrado**: executables on disk with no uninstall entry (portable or copied apps)
  - **Órfão**: an uninstall entry whose files are gone, or a folder left behind by something you removed
- Uninstall registered programs, or send unregistered and orphaned folders to the Recycle Bin

**Clean up safely**
- Recycle Bin by default; permanent delete only after a stronger confirmation
- **Empty folder** keeps the folder and removes what is inside
- Windows, Program Files, ProgramData, drive roots and your user folder can never be removed from the app
- Native right-click menus everywhere, plus keyboard shortcuts (Delete, Shift+Delete, Backspace)

**And also**
- **Saved scans** per drive: results show up instantly the next time you open the app
- **Administrator mode** to include protected folders
- **Reports** as a printable HTML page or a CSV for Excel
- Light, dark and Windows-default themes

## Performance

Measured on a real Windows PC:

| | |
| --- | --- |
| Startup | ~0.7 s to an interactive window |
| Full scan of C: (1.2 million files) | ~52 s, 23k files/s, 353 MB peak memory |
| Treemap | 3,000 cells drawn in under 9 ms, hover at 60 fps |
| Renderer JavaScript | under 100 KB gzipped |

The scan runs in its own process, so the window never freezes. Hard links are counted once, junctions are never
followed, and sizes are real "size on disk".

## Download

Get the latest build from the [Releases](https://github.com/JvTadeo/disk-sleuth/releases/latest) page:

- **`analisador-de-disco-<version>-instalador.exe`**: installs for your user only (no administrator rights needed)
  and adds Start menu and desktop shortcuts.
- **`analisador-de-disco-<version>-portatil.exe`**: runs without installing. Settings and saved scans are kept in a
  folder next to the `.exe`, so it works from a USB drive.

The builds are not code-signed, so the first time you run one Windows SmartScreen shows *"Windows protected your
PC"*. Click **More info**, then **Run anyway**.

## Build from source

Requirements: Windows 10 or 11 and [Node.js](https://nodejs.org) 22.12 or newer.

```bash
git clone https://github.com/JvTadeo/disk-sleuth.git
cd disk-sleuth
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the app with hot reload |
| `npm run typecheck` | Type-checks the main, preload and renderer code |
| `npm run dist:win` | Builds the installer and the portable `.exe` into `release/` |
| `npm run dist:setup` / `dist:portable` | Builds only one of them |
| `npm run test:detector` | Program classifier tests |
| `npm run test:scanner` | Scanner tests (categories, comparison, duplicates, cache) |
| `npm run test:report` | Report builder tests |
| `npm run bench -- C:\` | Benchmarks the scanner on a folder or drive |

### Releasing a new version

Releases are built by GitHub Actions (`.github/workflows/release.yml`). Bump the version and push the tag:

```bash
npm version patch      # 1.0.0 → 1.0.1 (use minor or major for bigger changes)
git push --follow-tags
```

The workflow type-checks, runs the tests, builds the installer and the portable `.exe` on Windows and publishes
them as a release with generated notes. A run started by hand from the Actions tab builds the files without
publishing a release.

## Tech stack

[Electron](https://www.electronjs.org) · [React 19](https://react.dev) · TypeScript ·
[electron-vite](https://electron-vite.org) · [Tailwind CSS v4](https://tailwindcss.com) ·
[shadcn/ui](https://ui.shadcn.com) · [Remix Icon](https://remixicon.com) · [Zustand](https://zustand.docs.pmnd.rs) ·
[TanStack Virtual](https://tanstack.com/virtual) · [electron-builder](https://www.electron.build)

How the scanner, the program detector, the cache and the rest work is described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```text
src/
  main/      main process: window, IPC, program detector, scan cache, elevation, reports
  preload/   typed bridge exposed to the window as window.api
  scanner/   scan engine (runs in a utilityProcess): compact tree, parallel walker, duplicates
  shared/    IPC contracts and types shared by every process
  renderer/  React UI: pages, components, treemap
```

## Roadmap

- [x] Disk scan, treemap and folder tree
- [x] Hidden program detection
- [x] Saved scans, comparison, duplicates, reports, administrator mode
- [x] Installer and portable build
- [ ] Optional: read the NTFS Master File Table directly for scans in seconds
