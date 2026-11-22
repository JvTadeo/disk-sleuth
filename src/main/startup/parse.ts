/**
 * Pure helpers for the startup manager: no Windows calls, so they run in tests on any OS.
 */

import type { Program } from '@shared/programs'
import type { StartupItem, StartupSource } from '@shared/startup'

const HKCU = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion'
const HKLM = 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion'
const APPROVED = 'Explorer\\StartupApproved'

/** The Run key (or folder) an entry lives in, as shown to the user. */
export const RUN_KEYS: Record<'runUser' | 'runMachine' | 'runMachine32', string> = {
  runUser: `${HKCU}\\Run`,
  runMachine: `${HKLM}\\Run`,
  runMachine32: 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'
}

/**
 * Where Windows records "disabled in Task Manager" for each source (tasks keep their own state).
 * The values there are named like the entry; 12 bytes: a DWORD (2 or 6 = enabled, 3 = disabled) and a FILETIME.
 */
export const APPROVED_KEYS: Record<Exclude<StartupSource, 'task'>, string> = {
  runUser: `${HKCU}\\${APPROVED}\\Run`,
  runMachine: `${HKLM}\\${APPROVED}\\Run`,
  runMachine32: `${HKLM}\\${APPROVED}\\Run32`,
  folderUser: `${HKCU}\\${APPROVED}\\StartupFolder`,
  folderCommon: `${HKLM}\\${APPROVED}\\StartupFolder`
}

export function needsAdmin(source: StartupSource): boolean {
  return source === 'runMachine' || source === 'runMachine32' || source === 'folderCommon' || source === 'task'
}

/** FILETIME (100 ns ticks since 1601) to ms since epoch. */
const FILETIME_EPOCH_MS = 11_644_473_600_000

/** Reads a StartupApproved value. No value at all means enabled. */
export function approvedState(bytes: number[] | null | undefined): { enabled: boolean; disabledAt: number | null } {
  if (!bytes || bytes.length < 4) return { enabled: true, disabledAt: null }
  const flag = bytes[0]
  // Odd flags (3, 7…) mean disabled; 2 and 6 mean enabled.
  const enabled = (flag & 1) === 0
  let disabledAt: number | null = null
  if (!enabled && bytes.length >= 12) {
    let ticks = 0n
    for (let i = 11; i >= 4; i--) ticks = (ticks << 8n) | BigInt(bytes[i] & 0xff)
    if (ticks > 0n) disabledAt = Number(ticks / 10_000n) - FILETIME_EPOCH_MS
  }
  return { enabled, disabledAt }
}

/** The 12-byte value Task Manager writes, as hex for reg.exe. */
export function approvedValue(enabled: boolean, now = Date.now()): string {
  const bytes = new Uint8Array(12)
  bytes[0] = enabled ? 2 : 3
  if (!enabled) {
    let ticks = BigInt(now + FILETIME_EPOCH_MS) * 10_000n
    for (let i = 4; i < 12; i++) {
      bytes[i] = Number(ticks & 0xffn)
      ticks >>= 8n
    }
  }
  return Buffer.from(bytes).toString('hex').toUpperCase()
}

/** Expands %VAR% with the given environment (case-insensitive names, as on Windows). Unknown variables stay. */
export function expandEnv(s: string, env: Record<string, string | undefined>): string {
  const lower = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]))
  return s.replace(/%([^%]+)%/g, (all, name: string) => lower.get(name.toLowerCase()) ?? all)
}

const LAUNCHERS = new Set(['rundll32.exe', 'cmd.exe', 'wscript.exe', 'cscript.exe', 'powershell.exe', 'pwsh.exe', 'mshta.exe'])

/**
 * The program file a startup command starts:
 * `"C:\x\app.exe" --flag` → C:\x\app.exe; `C:\x\app.exe -min` → C:\x\app.exe; `%windir%\x.exe` → expanded.
 * For launchers (rundll32, cmd, wscript…) the file they run is more telling, when there is one.
 */
export function exeFromStartupCommand(command: string, env: Record<string, string | undefined> = {}): string | null {
  const cmd = expandEnv(command, env).trim()
  if (!cmd) return null
  let exe: string | null = null
  let rest = ''
  if (cmd.startsWith('"')) {
    const end = cmd.indexOf('"', 1)
    if (end > 1) {
      exe = cmd.slice(1, end)
      rest = cmd.slice(end + 1)
    }
  } else {
    // Unquoted paths may hold spaces ("C:\Program Files\x\app.exe -min"): cut at the first executable extension.
    const m = cmd.match(/^(.+?\.(?:exe|com|bat|cmd|vbs|js|ps1|lnk))(?=\s|$)/i)
    if (m) {
      exe = m[1]
      rest = cmd.slice(m[1].length)
    } else {
      exe = cmd.split(/\s+/)[0]
      rest = cmd.slice(exe.length)
    }
  }
  if (!exe) return null
  const base = exe.split(/[\\/]/).pop()!.toLowerCase()
  if (LAUNCHERS.has(base)) {
    const inner = rest.match(/"([a-z]:\\[^"]+?\.(?:dll|exe|vbs|js|ps1|bat|cmd|hta))"|([a-z]:\\\S+?\.(?:dll|exe|vbs|js|ps1|bat|cmd|hta))\b/i)
    if (inner) return inner[1] ?? inner[2]
  }
  return exe
}

const SECURITY = /defender|kaspersky|avast|\bavg\b|norton|mcafee|bitdefender|\beset\b|malwarebytes|sophos|trend micro|avira|panda security|webroot|f-secure|comodo|gen digital/i

export function protectedKindOf(publisher: string | null, target: string | null, systemRoot?: string): StartupItem['protectedKind'] {
  if (publisher && SECURITY.test(publisher)) return 'security'
  if (publisher && /microsoft/i.test(publisher)) return 'microsoft'
  const root = systemRoot?.toLowerCase()
  if (root && target && target.toLowerCase().startsWith(root + '\\')) return 'microsoft'
  return null
}

/** The installed program a file belongs to: the one whose folder holds it (deepest folder wins). */
export function ownerOf(target: string | null, programs: Program[]): StartupItem['owner'] {
  if (!target) return null
  const t = target.toLowerCase()
  let best: Program | null = null
  for (const p of programs) {
    const loc = p.location?.toLowerCase().replace(/\\+$/, '')
    if (!loc || !(t.startsWith(loc + '\\') || p.iconPath?.toLowerCase() === t)) continue
    if (!best || (best.location?.length ?? 0) < loc.length) best = p
  }
  return best ? { id: best.id, name: best.name, status: best.status } : null
}
