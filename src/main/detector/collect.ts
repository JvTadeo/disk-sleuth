import { execFile } from 'node:child_process'
import { existsSync, type Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DriveInfo } from '@shared/ipc'
import type { Areas, AppxEntry, FolderArea, FolderCandidate, Inventory, RegistryEntry, ShortcutEntry } from './inventory'
import { DATA_IGNORE, DRIVE_ROOT_IGNORE, isIgnored, isMeaningfulExe, PROGRAM_FILES_IGNORE } from './names'

const run = promisify(execFile)

/**
 * One Windows PowerShell call returns everything that needs Windows APIs, as JSON:
 * the three Uninstall registry views, the user's Store packages and the Start menu shortcut targets.
 * It is sent with -EncodedCommand, so no quoting or escaping can break it.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$views = @(
  @{ view = '64';   path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' },
  @{ view = '32';   path = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' },
  @{ view = 'user'; path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' }
)
$registry = foreach ($v in $views) {
  Get-ItemProperty -Path $v.path | Where-Object { $_.DisplayName } | ForEach-Object {
    [pscustomobject]@{
      key = $_.PSChildName; view = $v.view; name = [string]$_.DisplayName
      version = [string]$_.DisplayVersion; publisher = [string]$_.Publisher
      installLocation = [string]$_.InstallLocation; uninstallString = [string]$_.UninstallString
      quietUninstallString = [string]$_.QuietUninstallString; displayIcon = [string]$_.DisplayIcon
      estimatedSizeKb = $_.EstimatedSize; systemComponent = ($_.SystemComponent -eq 1)
      parentKeyName = [string]$_.ParentKeyName; releaseType = [string]$_.ReleaseType
    }
  }
}
$appx = Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.IsResourcePackage -and $_.SignatureKind -ne 'System' } | ForEach-Object {
  [pscustomobject]@{
    name = $_.Name; packageFullName = $_.PackageFullName; publisher = [string]$_.Publisher
    version = [string]$_.Version; installLocation = [string]$_.InstallLocation; nonRemovable = [bool]$_.NonRemovable
  }
}
$shell = New-Object -ComObject WScript.Shell
$roots = @([Environment]::GetFolderPath('CommonStartMenu'), [Environment]::GetFolderPath('StartMenu'))
$shortcuts = foreach ($r in $roots) {
  Get-ChildItem -LiteralPath $r -Recurse -Filter *.lnk | ForEach-Object {
    $t = $shell.CreateShortcut($_.FullName).TargetPath
    if ($t) { [pscustomobject]@{ name = $_.BaseName; target = $t } }
  }
}
[pscustomobject]@{ registry = @($registry); appx = @($appx); shortcuts = @($shortcuts) } | ConvertTo-Json -Depth 4 -Compress
`

/** PowerShell turns one-item arrays into objects and an empty @($null) into [null]: normalize both. */
function toArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  return (Array.isArray(v) ? v : [v]).filter((x): x is T => x != null)
}

const clean = (s: unknown): string | undefined => {
  if (typeof s !== 'string') return undefined
  const t = s.trim().replace(/^"+|"+$/g, '').trim()
  return t || undefined
}

/** Pulls an .exe path out of DisplayIcon ("C:\x\app.exe,0") or UninstallString ("\"C:\x\unins000.exe\" /S"). */
export function exeFromCommand(cmd: string | undefined): string | undefined {
  if (!cmd) return undefined
  const quoted = cmd.match(/^\s*"([^"]+?\.exe)"/i)
  if (quoted) return quoted[1]
  const bare = cmd.match(/^\s*([a-z]:\\[^,"]*?\.exe)\b/i)
  if (bare) return bare[1]
  return undefined
}

/** "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond" → "Microsoft Corporation". */
function publisherFromCertificate(dn: string | undefined): string | undefined {
  if (!dn) return undefined
  const m = dn.match(/(?:^|,\s*)(?:O|CN)=("?)([^,"]+)\1/)
  return m ? m[2].trim() : dn
}

/** Uninstaller locations that say nothing about where the program lives. */
function isGenericExeLocation(p: string): boolean {
  const l = p.toLowerCase()
  return (
    l.includes('\\windows\\') ||
    l.includes('\\package cache\\') ||
    l.includes('\\installshield installation information\\') ||
    l.endsWith('\\msiexec.exe') ||
    l.includes('\\temp\\')
  )
}

async function runPowerShell(): Promise<{ registry: RegistryEntry[]; appx: AppxEntry[]; shortcuts: ShortcutEntry[] }> {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 90_000, encoding: 'utf8' }
  )
  // Windows PowerShell may prefix UTF-8 output with a BOM.
  const raw = JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '{}') as {
    registry?: Record<string, unknown>[] | Record<string, unknown>
    appx?: Record<string, unknown>[] | Record<string, unknown>
    shortcuts?: Record<string, unknown>[] | Record<string, unknown>
  }

  const registry: RegistryEntry[] = toArray(raw.registry).map((r) => ({
    key: String(r.key ?? ''),
    view: (r.view === '32' || r.view === 'user' ? r.view : '64') as RegistryEntry['view'],
    name: String(r.name ?? '').trim(),
    version: clean(r.version),
    publisher: clean(r.publisher),
    installLocation: clean(r.installLocation)?.replace(/\\+$/, ''),
    uninstallString: clean(r.uninstallString) && String(r.uninstallString).trim(),
    quietUninstallString: clean(r.quietUninstallString) && String(r.quietUninstallString).trim(),
    displayIcon: clean(r.displayIcon),
    estimatedSizeKb: typeof r.estimatedSizeKb === 'number' ? r.estimatedSizeKb : undefined,
    systemComponent: r.systemComponent === true,
    parentKeyName: clean(r.parentKeyName),
    releaseType: clean(r.releaseType)
  }))

  for (const r of registry) {
    if (r.installLocation) r.locationExists = existsSync(r.installLocation)
    const icon = exeFromCommand(r.displayIcon)
    if (icon && !isGenericExeLocation(icon)) {
      r.iconExe = icon
      r.iconExeExists = existsSync(icon)
    }
    const uninstaller = exeFromCommand(r.uninstallString)
    if (uninstaller && !isGenericExeLocation(uninstaller)) {
      r.uninstallExe = uninstaller
      r.uninstallExeExists = existsSync(uninstaller)
    }
  }

  const appx: AppxEntry[] = toArray(raw.appx).map((a) => ({
    name: String(a.name ?? ''),
    packageFullName: String(a.packageFullName ?? ''),
    publisher: publisherFromCertificate(clean(a.publisher)),
    version: clean(a.version),
    installLocation: clean(a.installLocation),
    nonRemovable: a.nonRemovable === true
  }))

  const shortcuts: ShortcutEntry[] = toArray(raw.shortcuts)
    .map((s) => ({ name: String(s.name ?? ''), target: String(s.target ?? '') }))
    .filter((s) => /^[a-z]:\\/i.test(s.target))

  return { registry, appx, shortcuts }
}

// ---------- folders ----------

const MAX_VISITS = 400

async function dirs(path: string): Promise<Dirent[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.isSymbolicLink())
  } catch {
    return []
  }
}

/** Looks for meaningful .exe files up to two levels down, stopping early. Returns paths relative to `path`. */
async function findExes(path: string, depth = 2): Promise<string[]> {
  const found: string[] = []
  let visits = 0
  const walk = async (p: string, d: number, rel: string): Promise<void> => {
    if (found.length >= 3 || visits++ > MAX_VISITS) return
    let entries: Dirent[]
    try {
      entries = await readdir(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.exe') && isMeaningfulExe(e.name)) {
        found.push(rel ? `${rel}\\${e.name}` : e.name)
        if (found.length >= 3) return
      }
    }
    if (d === 0) return
    for (const e of entries) {
      if (e.isDirectory() && !e.isSymbolicLink()) await walk(join(p, e.name), d - 1, rel ? `${rel}\\${e.name}` : e.name)
      if (found.length >= 3) return
    }
  }
  await walk(path, depth, '')
  return found
}

/**
 * Program areas: each top folder is a candidate. A folder with no executables of its own but
 * with subfolders is treated as a vendor container ("Adobe", "Games") and its subfolders become candidates.
 */
async function programArea(root: string | undefined, area: FolderArea, ignore: Set<string>): Promise<FolderCandidate[]> {
  if (!root || !existsSync(root)) return []
  const out: FolderCandidate[] = []
  await Promise.all(
    (await dirs(root)).map(async (d) => {
      if (isIgnored(ignore, d.name)) return
      const path = join(root, d.name)
      const own = await findExes(path, 0)
      if (own.length) {
        out.push({ path, name: d.name, area, exes: own })
        return
      }
      const subs = await dirs(path)
      if (!subs.length || subs.length > 60) {
        out.push({ path, name: d.name, area, exes: await findExes(path) })
        return
      }
      const children = await Promise.all(
        subs.map(async (s) => ({ path: join(path, s.name), name: s.name, area, container: d.name, exes: await findExes(join(path, s.name)) }))
      )
      // A container whose subfolders hold nothing executable is one leftover, not many.
      if (children.every((c) => !c.exes.length)) out.push({ path, name: d.name, area, exes: [] })
      else out.push(...children)
    })
  )
  return out
}

async function dataArea(root: string | undefined, area: FolderArea): Promise<FolderCandidate[]> {
  if (!root || !existsSync(root)) return []
  return Promise.all(
    (await dirs(root))
      .filter((d) => !isIgnored(DATA_IGNORE, d.name))
      .map(async (d) => ({ path: join(root, d.name), name: d.name, area, exes: await findExes(join(root, d.name)) }))
  )
}

export function areasFromEnv(env: NodeJS.ProcessEnv = process.env): Areas {
  return {
    programFiles: env.ProgramW6432 || env.ProgramFiles,
    programFilesX86: env['ProgramFiles(x86)'],
    localPrograms: env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs') : undefined,
    appDataLocal: env.LOCALAPPDATA,
    appDataRoaming: env.APPDATA,
    programData: env.ProgramData,
    systemRoot: env.SystemRoot,
    userProfile: env.USERPROFILE
  }
}

/** Collects everything the classifier needs. Windows only. */
export async function collectInventory(drives: DriveInfo[]): Promise<Inventory> {
  const warnings: string[] = []
  const areas = areasFromEnv()

  const ps = runPowerShell().catch((err: Error) => {
    warnings.push(`PowerShell: ${err.message.split('\n')[0]}`)
    return { registry: [], appx: [], shortcuts: [] }
  })

  const folderJobs: Promise<FolderCandidate[]>[] = [
    programArea(areas.programFiles, 'programFiles', PROGRAM_FILES_IGNORE),
    areas.programFilesX86 !== areas.programFiles
      ? programArea(areas.programFilesX86, 'programFilesX86', PROGRAM_FILES_IGNORE)
      : Promise.resolve([]),
    programArea(areas.localPrograms, 'localPrograms', PROGRAM_FILES_IGNORE),
    dataArea(areas.appDataLocal, 'appDataLocal'),
    dataArea(areas.appDataRoaming, 'appDataRoaming'),
    dataArea(areas.programData, 'programData'),
    ...drives.map((d) => programArea(d.root, 'driveRoot', DRIVE_ROOT_IGNORE))
  ]

  const [{ registry, appx, shortcuts }, ...folderLists] = await Promise.all([ps, ...folderJobs])
  return { registry, appx, shortcuts, folders: folderLists.flat(), warnings }
}

