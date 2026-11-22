import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { StartupSource } from '@shared/startup'

const run = promisify(execFile)

export interface RawEntry {
  source: StartupSource
  /** Registry value name, shortcut file name, or task name. */
  name: string
  command: string
  /** Startup folder, for folder entries. */
  folder?: string
  /** Task folder ("\" or "\Vendor\"), for tasks. */
  taskPath?: string
  /** Tasks keep their own enabled state. */
  enabled?: boolean
}

export interface RawApproved {
  source: Exclude<StartupSource, 'task'>
  name: string
  bytes: number[]
}

export interface FileInfo {
  path: string
  /** The path that was looked up, after resolving a bare name ("app.exe") through PATH. */
  resolved: string | null
  exists: boolean | null
  company: string | null
  description: string | null
}

/**
 * One PowerShell call reads every startup location as JSON: the three Run keys, the StartupApproved records,
 * both Startup folders (shortcut targets resolved) and the scheduled tasks that run at logon or boot.
 * Microsoft's own tasks (\Microsoft\…) are left out: there are hundreds and they are part of Windows.
 * Registry values are read without expanding %VARIABLES%, so commands look the way they are stored.
 */
const COLLECT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Values($path) {
  $k = Get-Item -LiteralPath $path
  if (-not $k) { return }
  foreach ($n in $k.GetValueNames()) {
    if ($n -ne '') { [pscustomobject]@{ name = $n; value = $k.GetValue($n, $null, 'DoNotExpandEnvironmentNames') } }
  }
}
$cv = 'Software\Microsoft\Windows\CurrentVersion'
$run = foreach ($s in @(
  @{ src = 'runUser'; p = "HKCU:\$cv\Run" },
  @{ src = 'runMachine'; p = "HKLM:\$cv\Run" },
  @{ src = 'runMachine32'; p = "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run" })) {
  foreach ($v in Values $s.p) { if ($v.value -is [string]) { [pscustomobject]@{ source = $s.src; name = $v.name; command = $v.value } } }
}
$ap = "$cv\Explorer\StartupApproved"
$approved = foreach ($s in @(
  @{ src = 'runUser'; p = "HKCU:\$ap\Run" },
  @{ src = 'runMachine'; p = "HKLM:\$ap\Run" },
  @{ src = 'runMachine32'; p = "HKLM:\$ap\Run32" },
  @{ src = 'folderUser'; p = "HKCU:\$ap\StartupFolder" },
  @{ src = 'folderCommon'; p = "HKLM:\$ap\StartupFolder" })) {
  foreach ($v in Values $s.p) {
    if ($v.value -is [byte[]]) { [pscustomobject]@{ source = $s.src; name = $v.name; bytes = @($v.value | ForEach-Object { [int]$_ }) } }
  }
}
$shell = New-Object -ComObject WScript.Shell
$folders = foreach ($s in @(
  @{ src = 'folderUser'; p = [Environment]::GetFolderPath('Startup') },
  @{ src = 'folderCommon'; p = [Environment]::GetFolderPath('CommonStartup') })) {
  Get-ChildItem -LiteralPath $s.p -File -Force | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
    $cmd = '"' + $_.FullName + '"'
    if ($_.Extension -eq '.lnk') {
      $l = $shell.CreateShortcut($_.FullName)
      if ($l.TargetPath) { $cmd = '"' + $l.TargetPath + '"'; if ($l.Arguments) { $cmd += ' ' + $l.Arguments } }
    }
    [pscustomobject]@{ source = $s.src; name = $_.Name; command = $cmd; folder = $s.p }
  }
}
$triggers = @('MSFT_TaskLogonTrigger', 'MSFT_TaskBootTrigger')
$tasks = Get-ScheduledTask | Where-Object {
  $_.TaskPath -notlike '\Microsoft\*' -and ($_.Triggers | Where-Object { $triggers -contains $_.CimClass.CimClassName })
} | ForEach-Object {
  $a = $_.Actions | Where-Object { $_.Execute } | Select-Object -First 1
  if ($a) {
    $cmd = '"' + $a.Execute.Trim('"') + '"'
    if ($a.Arguments) { $cmd += ' ' + $a.Arguments }
    [pscustomobject]@{ source = 'task'; name = $_.TaskName; taskPath = $_.TaskPath; command = $cmd; enabled = ($_.State -ne 'Disabled') }
  }
}
ConvertTo-Json -Compress -Depth 4 -InputObject ([pscustomobject]@{ run = @($run); approved = @($approved); folders = @($folders); tasks = @($tasks) })
`

/** Version info and existence for many files at once. Paths travel as base64 JSON, so nothing needs escaping. */
const INSPECT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PATHS__')) | ConvertFrom-Json
$out = foreach ($p in $paths) {
  $r = $p
  if (-not [IO.Path]::IsPathRooted($p)) {
    $c = Get-Command -Name $p -CommandType Application | Select-Object -First 1
    $r = if ($c) { $c.Source } else { $null }
  }
  if (-not $r) { [pscustomobject]@{ path = $p; resolved = $null; exists = $null }; continue }
  $i = Get-Item -LiteralPath $r -Force
  if ($i) {
    $v = $i.VersionInfo
    [pscustomobject]@{ path = $p; resolved = $r; exists = $true; company = [string]$v.CompanyName; description = [string]$v.FileDescription }
  } else {
    [pscustomobject]@{ path = $p; resolved = $r; exists = $false }
  }
}
ConvertTo-Json -Compress -InputObject @($out)
`

export async function powershell(script: string, timeout = 60_000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout, encoding: 'utf8' }
  )
  // Windows PowerShell may prefix UTF-8 output with a BOM.
  return stdout.replace(/^﻿/, '').trim()
}

/** PowerShell turns one-item arrays into objects and empty ones into null: normalize. */
export function toArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  return (Array.isArray(v) ? v : [v]).filter((x): x is T => x != null)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const opt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export async function collectStartup(): Promise<{ entries: RawEntry[]; approved: RawApproved[] }> {
  const raw = JSON.parse((await powershell(COLLECT, 90_000)) || '{}') as Record<string, unknown>
  const entries: RawEntry[] = []
  for (const r of toArray(raw.run as Record<string, unknown>[])) {
    entries.push({ source: str(r.source) as StartupSource, name: str(r.name), command: str(r.command) })
  }
  for (const f of toArray(raw.folders as Record<string, unknown>[])) {
    entries.push({ source: str(f.source) as StartupSource, name: str(f.name), command: str(f.command), folder: str(f.folder) })
  }
  for (const t of toArray(raw.tasks as Record<string, unknown>[])) {
    entries.push({ source: 'task', name: str(t.name), command: str(t.command), taskPath: str(t.taskPath) || '\\', enabled: t.enabled !== false })
  }
  const approved: RawApproved[] = toArray(raw.approved as Record<string, unknown>[]).map((a) => ({
    source: str(a.source) as RawApproved['source'],
    name: str(a.name),
    bytes: toArray(a.bytes as number[]).map((n) => Number(n))
  }))
  return { entries: entries.filter((e) => e.name && e.command), approved }
}

export async function inspectFiles(paths: string[]): Promise<Map<string, FileInfo>> {
  const out = new Map<string, FileInfo>()
  if (!paths.length) return out
  const b64 = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64')
  const raw = JSON.parse((await powershell(INSPECT.replace('__PATHS__', b64))) || '[]') as unknown
  for (const r of toArray(raw as Record<string, unknown>[])) {
    const path = str(r.path)
    out.set(path.toLowerCase(), {
      path,
      resolved: opt(r.resolved),
      exists: r.exists === true ? true : r.exists === false ? false : null,
      company: opt(r.company),
      description: opt(r.description)
    })
  }
  return out
}
