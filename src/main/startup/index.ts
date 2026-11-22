import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type { Program } from '@shared/programs'
import type { StartupItem, StartupResult, StartupSource } from '@shared/startup'
import { collectStartup, inspectFiles, powershell, type RawEntry } from './collect'
import {
  APPROVED_KEYS,
  approvedState,
  approvedValue,
  exeFromStartupCommand,
  needsAdmin,
  ownerOf,
  protectedKindOf,
  RUN_KEYS
} from './parse'

const run = promisify(execFile)

const FOLDER_LABEL: Record<'folderUser' | 'folderCommon', string> = {
  folderUser: 'Pasta Inicializar (usuário)',
  folderCommon: 'Pasta Inicializar (todos os usuários)'
}

interface Entry {
  item: StartupItem
  raw: RawEntry
}

export interface StartupDeps {
  isAdmin: () => Promise<boolean>
  /** The detected programs, to link each entry to its program. */
  programs: () => Promise<Program[]>
}

/** Runs reg.exe with plain arguments (no shell). Throws with reg.exe's message on failure. */
async function reg(args: string[]): Promise<void> {
  try {
    await run('reg.exe', args, { windowsHide: true, timeout: 15_000 })
  } catch (err) {
    const e = err as { stderr?: string; message: string }
    throw new Error((e.stderr || e.message).trim())
  }
}

/** Embeds values in a PowerShell script as base64 JSON, so nothing needs escaping. */
const psArgs = (v: unknown): string => Buffer.from(JSON.stringify(v), 'utf8').toString('base64')

/** Programs that start with Windows: listing, enabling/disabling the way Task Manager does, and removing orphans. */
export class StartupManager {
  private entries: Entry[] = []
  private last: StartupResult | null = null

  constructor(private deps: StartupDeps) {}

  get result(): StartupResult | null {
    return this.last
  }

  async list(): Promise<StartupResult> {
    const t0 = performance.now()
    // Debugging aid (like DISK_ANALYZER_INVENTORY for programs): show a saved list instead of reading Windows.
    const fixture = process.env.DISK_ANALYZER_STARTUP_FIXTURE
    if (fixture) {
      this.last = JSON.parse(readFileSync(fixture, 'utf8')) as StartupResult
      this.entries = this.last.items.map((item) => ({ item, raw: { source: item.source, name: item.entryName, command: item.command } }))
      return this.last
    }
    if (process.platform !== 'win32') {
      this.last = { supported: false, items: [], isAdmin: false, durationMs: 0, warnings: [] }
      return this.last
    }
    const warnings: string[] = []
    const [collected, programs, admin] = await Promise.all([
      collectStartup(),
      this.deps.programs().catch(() => [] as Program[]),
      this.deps.isAdmin()
    ])
    const { entries, approved } = collected
    const states = new Map(approved.map((a) => [`${a.source}:${a.name.toLowerCase()}`, approvedState(a.bytes)]))

    const targets = entries.map((e) => exeFromStartupCommand(e.command, process.env))
    const files = await inspectFiles([...new Set(targets.filter((t): t is string => !!t))]).catch((err) => {
      warnings.push(`Não foi possível ler os detalhes dos arquivos: ${err instanceof Error ? err.message : String(err)}`)
      return new Map()
    })

    this.entries = entries.map((raw, i) => {
      const target = targets[i]
      const info = target ? files.get(target.toLowerCase()) : undefined
      const resolved = info?.resolved ?? target
      const state =
        raw.source === 'task'
          ? { enabled: raw.enabled !== false, disabledAt: null }
          : (states.get(`${raw.source}:${raw.name.toLowerCase()}`) ?? { enabled: true, disabledAt: null })
      const location =
        raw.source === 'task'
          ? `Agendador de Tarefas › ${(raw.taskPath ?? '\\') + raw.name}`
          : raw.source === 'folderUser' || raw.source === 'folderCommon'
            ? `${FOLDER_LABEL[raw.source]} · ${raw.folder ?? ''}`
            : `${RUN_KEYS[raw.source]} · ${raw.name}`
      const baseName = raw.name.replace(/\.lnk$/i, '')
      const item: StartupItem = {
        id: `${raw.source}:${raw.source === 'task' ? (raw.taskPath ?? '\\') + raw.name : raw.name}`,
        name: info?.description && info.description.length <= 60 ? info.description : baseName,
        source: raw.source,
        entryName: raw.name,
        command: raw.command,
        target: resolved ?? null,
        targetExists: info?.exists ?? null,
        publisher: info?.company ?? null,
        enabled: state.enabled,
        disabledAt: state.disabledAt,
        needsAdmin: needsAdmin(raw.source),
        protectedKind: protectedKindOf(info?.company ?? null, resolved ?? null, process.env.SystemRoot),
        location,
        owner: ownerOf(resolved ?? null, programs)
      }
      return { item, raw }
    })

    this.last = {
      supported: true,
      items: this.entries.map((e) => e.item),
      isAdmin: admin,
      durationMs: Math.round(performance.now() - t0),
      warnings
    }
    return this.last
  }

  private find(id: unknown): Entry {
    const e = typeof id === 'string' ? this.entries.find((x) => x.item.id === id) : undefined
    if (!e) throw new Error('Item não encontrado. Atualize a lista.')
    return e
  }

  private refreshResult(): StartupResult {
    if (!this.last) throw new Error('Atualize a lista.')
    this.last = { ...this.last, items: this.entries.map((e) => e.item) }
    return this.last
  }

  private async assertAllowed(e: Entry): Promise<void> {
    if (e.item.needsAdmin && !(await this.deps.isAdmin())) {
      throw new Error('Este item vale para todos os usuários do PC: reabra o app como administrador para mudá-lo.')
    }
  }

  /** Same effect as Task Manager's Enable/Disable: the entry stays, Windows just skips it. */
  async setEnabled(id: unknown, enabled: boolean): Promise<StartupResult> {
    const e = this.find(id)
    await this.assertAllowed(e)
    if (e.raw.source === 'task') {
      const cmd = enabled ? 'Enable-ScheduledTask' : 'Disable-ScheduledTask'
      await powershell(
        `$ErrorActionPreference = 'Stop'\n$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${psArgs({ p: e.raw.taskPath, n: e.raw.name })}')) | ConvertFrom-Json\n${cmd} -TaskPath $t.p -TaskName $t.n | Out-Null`
      )
    } else {
      await reg(['add', APPROVED_KEYS[e.raw.source], '/v', e.raw.name, '/t', 'REG_BINARY', '/d', approvedValue(enabled), '/f'])
    }
    e.item = { ...e.item, enabled, disabledAt: enabled ? null : Date.now() }
    return this.refreshResult()
  }

  /** Removes an orphaned entry (its program file is gone). Registry values are deleted; shortcuts go to the Recycle Bin. */
  async remove(id: unknown): Promise<StartupResult> {
    const e = this.find(id)
    if (e.item.targetExists !== false) throw new Error('Só entradas órfãs (cujo arquivo não existe mais) podem ser removidas daqui.')
    await this.assertAllowed(e)
    const src: StartupSource = e.raw.source
    if (src === 'task') {
      await powershell(
        `$ErrorActionPreference = 'Stop'\n$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${psArgs({ p: e.raw.taskPath, n: e.raw.name })}')) | ConvertFrom-Json\nUnregister-ScheduledTask -TaskPath $t.p -TaskName $t.n -Confirm:$false`
      )
    } else if (src === 'folderUser' || src === 'folderCommon') {
      await shell.trashItem(join(e.raw.folder ?? '', e.raw.name))
    } else {
      await reg(['delete', RUN_KEYS[src], '/v', e.raw.name, '/f'])
    }
    if (src !== 'task') await reg(['delete', APPROVED_KEYS[src], '/v', e.raw.name, '/f']).catch(() => {})
    this.entries = this.entries.filter((x) => x !== e)
    return this.refreshResult()
  }

  /** Shows the program file in Explorer (or the shortcut, for Startup folder entries whose target is gone). */
  showFile(id: unknown): void {
    const e = this.find(id)
    if (e.item.target && e.item.targetExists) shell.showItemInFolder(e.item.target)
    else if (e.raw.folder) shell.showItemInFolder(join(e.raw.folder, e.raw.name))
    else throw new Error('O arquivo deste item não existe mais.')
  }
}
