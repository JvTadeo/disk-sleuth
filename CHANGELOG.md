# Changelog

## 2.0.0

Two new pages, both in the sidebar.

### Lixo de dev (developer junk)

- Finds folders a command can rebuild, using the disk scan (no second pass over the disk): `node_modules`, `.next`,
  `.nuxt`, `.svelte-kit`, `.turbo`, Rust and Maven `target`, .NET `bin`/`obj`, Python virtual environments and tool
  caches, Gradle and Flutter builds, Unity `Library`/`Temp`.
- A folder only counts when the file that proves what it is sits next to it (`package.json`, `Cargo.toml`, `.csproj`…).
  Generic names (`dist`, `build`, `out`) also need the project's `.gitignore` to list them. Source code never shows up.
- Shows when each project was last changed (git history and project files) and filters by age.
- Measures the global caches of npm, pnpm, Yarn, Bun, pip, uv, NuGet, Gradle, Maven, Cargo, Go, Electron and
  electron-builder, and cleans them with the tool's own command when it has one.
- Select whole projects or single folders; Recycle Bin or permanent delete, with one confirmation. The sidebar shows how
  much can be freed.

### Inicialização (startup programs)

- Lists everything that starts with Windows: the Run registry keys (this user and all users), both Startup folders and
  scheduled tasks that run at logon or boot.
- Enables and disables entries exactly like Task Manager, so both always agree. Nothing is deleted.
- Links each entry to its installed program, flags Microsoft and security software, and removes orphaned entries whose
  program is gone.
- All-users entries need administrator rights; the page offers to reopen the app elevated.

### Also

- Pages fit the window: only tables scroll.

## 1.0.1

- Release files named `…-installer.exe` and `…-portable.exe`.
- GitHub Actions: type-check and tests on every push, installer and portable built and published for every version tag.

## 1.0.0

First release: disk scan with treemap and folder tree, largest files, duplicates, scan comparison, hidden program
detection (registered, unregistered, orphaned), saved scans, administrator mode, HTML/CSV reports, installer and
portable build.
