import type { Program } from '@shared/programs'
import type { Areas, FolderCandidate, Inventory, RegistryEntry } from './inventory'
import { isGenericName, namesMatch, norm } from './names'

export type SizeLookup = (path: string) => number | undefined

export interface ClassifyOptions {
  areas: Areas
  driveRoots: string[]
  /** Size of a folder from the disk scan; undefined when unknown. */
  sizeOf?: SizeLookup
}

/** Data folders smaller than this are not worth reporting as leftovers (and are noisy). */
const LEFTOVER_DATA_MIN_BYTES = 100 * 1024 * 1024

const PROGRAM_AREAS = new Set(['programFiles', 'programFilesX86', 'localPrograms'])
const DATA_AREAS = new Set(['appDataLocal', 'appDataRoaming', 'programData'])

const lower = (p: string): string => p.toLowerCase().replace(/[\\/]+$/, '')
const parentDir = (p: string): string => p.replace(/[\\/][^\\/]+$/, '')

/** a is b, or a lies inside b. */
const within = (a: string, b: string): boolean => a === b || a.startsWith(b + '\\') || a.startsWith(b + '/')

function isUpdateEntry(r: RegistryEntry): boolean {
  if (r.parentKeyName) return true
  if (r.releaseType && /update|hotfix/i.test(r.releaseType)) return true
  return /\(KB\d{6,}\)|^(security )?update for |^hotfix for /i.test(r.name)
}

/**
 * Turns raw facts into the program list.
 *
 * Rules, from strongest to weakest evidence:
 * 1. Registry entries are registered programs, unless both their folder and their own uninstaller are gone
 *    (then the entry is an orphan, high confidence).
 * 2. Store packages are registered.
 * 3. A folder belongs to a program when the program's location or executables are inside it (or vice versa),
 *    when a Start menu shortcut of that program points into it, or when the names match.
 * 4. Unclaimed folders with executables are "not registered" (portable or copied installs).
 * 5. Unclaimed program folders without executables, and unclaimed data folders over 100 MB,
 *    are orphans, but only "likely": they are heuristics, and the window says so.
 */
export function classify(inv: Inventory, opts: ClassifyOptions): Program[] {
  const { areas, sizeOf } = opts

  // Locations that are too broad to identify one program (an entry pointing at "C:\Program Files").
  const broad = new Set(
    [
      areas.programFiles,
      areas.programFilesX86,
      areas.localPrograms,
      areas.appDataLocal,
      areas.appDataRoaming,
      areas.programData,
      areas.systemRoot,
      areas.userProfile,
      areas.userProfile && areas.userProfile + '\\AppData',
      areas.userProfile && parentDir(areas.userProfile),
      ...opts.driveRoots
    ]
      .filter((p): p is string => !!p)
      .map(lower)
  )
  const usable = (p: string | undefined): string | undefined => {
    if (!p) return undefined
    const l = lower(p)
    return l.length > 3 && !broad.has(l) ? l : undefined
  }

  const programs: Program[] = []
  /** Lowercased paths that identify each program (install folder and executable folders). */
  const anchors = new Map<Program, string[]>()

  // ---------- 1. registry ----------
  const seen = new Map<string, Program>()
  for (const r of inv.registry) {
    if (!r.name || isUpdateEntry(r)) continue

    const iconDir = r.iconExe ? usable(parentDir(r.iconExe)) : undefined
    const uninstallDir = r.uninstallExe ? usable(parentDir(r.uninstallExe)) : undefined
    const location = usable(r.installLocation)

    const folderGone = !!r.installLocation && r.locationExists === false
    const iconGone = !r.iconExe || r.iconExeExists === false
    const uninstallerGone = !!r.uninstallExe && r.uninstallExeExists === false
    const orphan =
      (folderGone && iconGone && (!r.uninstallExe || uninstallerGone)) ||
      (!r.installLocation && uninstallerGone && iconGone)

    const hidden = !orphan && (!!r.systemComponent || !r.uninstallString)
    const p: Program = {
      id: `reg:${r.view}:${r.key}`,
      name: r.name,
      publisher: r.publisher,
      version: r.version,
      status: orphan ? 'orphan' : 'reg',
      confidence: 'high',
      kind: 'win32',
      reason: orphan ? 'registryMissingFolder' : hidden ? 'systemComponent' : 'registered',
      location: r.installLocation ?? (r.iconExe ? parentDir(r.iconExe) : undefined),
      sources: { registry: true, folder: !orphan && !!(location || iconDir), shortcut: false, store: false },
      scope: r.view === 'user' ? 'user' : 'machine',
      hidden,
      canUninstall: !orphan && !!r.uninstallString,
      canTrash: false,
      ...(r.iconExe && r.iconExeExists !== false ? { iconPath: r.iconExe } : {})
    }
    if (p.location && !usable(p.location)) p.location = undefined

    // The same product often appears in both registry views; keep one.
    const dedupeKey = `${norm(r.name)}|${r.version ?? ''}`
    const prev = seen.get(dedupeKey)
    if (prev) {
      if (!prev.location && p.location) prev.location = p.location
      continue
    }
    seen.set(dedupeKey, p)
    programs.push(p)
    if (r.estimatedSizeKb && r.estimatedSizeKb > 0) {
      p.size = r.estimatedSizeKb * 1024
      p.sizeSource = 'registry'
    }
    anchors.set(p, [location, iconDir, uninstallDir].filter((x): x is string => !!x))
  }

  // ---------- 2. Store packages ----------
  for (const a of inv.appx) {
    const p: Program = {
      id: `appx:${a.packageFullName}`,
      name: a.name,
      publisher: a.publisher,
      version: a.version,
      status: 'reg',
      confidence: 'high',
      kind: 'store',
      reason: 'store',
      location: a.installLocation,
      sources: { registry: false, folder: !!a.installLocation, shortcut: false, store: true },
      scope: 'user',
      hidden: !!a.nonRemovable,
      canUninstall: !a.nonRemovable,
      canTrash: false
    }
    programs.push(p)
    const loc = usable(a.installLocation)
    anchors.set(p, loc ? [loc] : [])
  }

  // ---------- 3. shortcuts point at program folders ----------
  const shortcuts = inv.shortcuts.map((s) => ({ name: s.name, dir: lower(parentDir(s.target)) }))
  const owned = [...programs]
  for (const p of owned) {
    const a = anchors.get(p) ?? []
    if (shortcuts.some((s) => a.some((x) => within(s.dir, x)))) p.sources.shortcut = true
  }

  // ---------- 4/5. folders ----------
  const ownerByPath = (c: FolderCandidate): Program | undefined => {
    const path = lower(c.path)
    return owned.find((p) => (anchors.get(p) ?? []).some((x) => within(x, path) || within(path, x)))
  }
  const ownerByName = (c: FolderCandidate): Program | undefined => {
    const names = [c.name]
    if (isGenericName(c.name) && !c.container) return undefined
    if (c.container && !isGenericName(c.container)) names.push(c.container)
    return owned.find((p) =>
      names.some((n) => !isGenericName(n) && (namesMatch(n, p.name) || namesMatch(n, p.publisher)))
    )
  }

  for (const c of inv.folders) {
    const path = lower(c.path)
    const owner = ownerByPath(c) ?? ownerByName(c)
    const exePath = c.exes[0] ? `${c.path}\\${c.exes[0]}` : undefined
    if (owner) {
      owner.sources.folder = true
      if (!owner.iconPath && exePath && owner.kind === 'win32') owner.iconPath = exePath
      if (!owner.location && PROGRAM_AREAS.has(c.area)) {
        owner.location = c.path
        anchors.get(owner)?.push(path)
      }
      continue
    }

    const shortcut = shortcuts.find((s) => within(s.dir, path))
    if (c.exes.length) {
      programs.push({
        id: `dir:${path}`,
        name: shortcut?.name ?? c.name,
        status: 'unreg',
        confidence: 'high',
        kind: 'folder',
        reason: 'noRegistryWithExe',
        location: c.path,
        sources: { registry: false, folder: true, shortcut: !!shortcut, store: false },
        hidden: false,
        canUninstall: false,
        canTrash: true,
        iconPath: exePath
      })
      continue
    }

    if (PROGRAM_AREAS.has(c.area)) {
      programs.push({
        id: `dir:${path}`,
        name: c.container ? `${c.container} \\ ${c.name}` : c.name,
        status: 'orphan',
        confidence: 'likely',
        kind: 'folder',
        reason: 'leftoverFolder',
        location: c.path,
        sources: { registry: false, folder: true, shortcut: !!shortcut, store: false },
        hidden: false,
        canUninstall: false,
        canTrash: true
      })
      continue
    }

    if (DATA_AREAS.has(c.area)) {
      const size = sizeOf?.(c.path)
      if (size === undefined || size < LEFTOVER_DATA_MIN_BYTES) continue
      programs.push({
        id: `dir:${path}`,
        name: c.name,
        status: 'orphan',
        confidence: 'likely',
        kind: 'folder',
        reason: 'leftoverData',
        location: c.path,
        size,
        sizeSource: 'scan',
        sources: { registry: false, folder: true, shortcut: false, store: false },
        hidden: false,
        canUninstall: false,
        canTrash: true
      })
    }
    // Drive-root folders without executables are the user's own files: never reported.
  }

  // ---------- sizes from the scan (exact) beat registry estimates ----------
  if (sizeOf) {
    for (const p of programs) {
      if (p.sizeSource === 'scan' || !p.location || p.reason === 'registryMissingFolder') continue
      const s = sizeOf(p.location)
      if (s !== undefined) {
        p.size = s
        p.sizeSource = 'scan'
      }
    }
  }

  const order = { orphan: 0, unreg: 1, reg: 2 }
  return programs.sort((a, b) => order[a.status] - order[b.status] || (b.size ?? 0) - (a.size ?? 0) || a.name.localeCompare(b.name))
}
