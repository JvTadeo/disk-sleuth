import { spawn } from 'node:child_process'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { shell, type IpcMainInvokeEvent } from 'electron'
import type { DevCache, DevCleanRequest, DevCleanResult, DevJunkResult, DevProject } from '@shared/devjunk'
import type { RemoveMode } from '@shared/ipc'
import type { ScanNode } from '@shared/scan'
import { formatBytes } from '@shared/format'
import type { ScannerHost } from './scanner-host'

/** A global package cache of a developer tool. */
interface CacheDef {
  id: string
  name: string
  /** Absolute folder, or null when the environment variable it hangs off is missing. */
  dir: string | null
  /** Official cleanup command. Without one (or when the tool is not installed) the folder is emptied. */
  command?: string
  note: string
}

const LOCAL = process.env.LOCALAPPDATA
const HOME = process.env.USERPROFILE
const at = (base: string | undefined, ...parts: string[]): string | null => (base ? join(base, ...parts) : null)

const REDOWNLOAD = 'Os pacotes voltam a ser baixados quando um projeto precisar.'

const CACHES: CacheDef[] = [
  { id: 'npm', name: 'Cache do npm', dir: at(LOCAL, 'npm-cache'), command: 'npm cache clean --force', note: REDOWNLOAD },
  {
    id: 'pnpm',
    name: 'Store do pnpm',
    dir: at(LOCAL, 'pnpm', 'store'),
    command: 'pnpm store prune',
    note: 'Remove só os pacotes que nenhum projeto usa mais.'
  },
  { id: 'yarn', name: 'Cache do Yarn', dir: at(LOCAL, 'Yarn', 'Cache'), command: 'yarn cache clean', note: REDOWNLOAD },
  { id: 'bun', name: 'Cache do Bun', dir: at(HOME, '.bun', 'install', 'cache'), command: 'bun pm cache rm', note: REDOWNLOAD },
  { id: 'pip', name: 'Cache do pip', dir: at(LOCAL, 'pip', 'cache'), command: 'pip cache purge', note: REDOWNLOAD },
  { id: 'uv', name: 'Cache do uv', dir: at(LOCAL, 'uv', 'cache'), command: 'uv cache clean', note: REDOWNLOAD },
  {
    id: 'nuget',
    name: 'Pacotes do NuGet',
    dir: at(HOME, '.nuget', 'packages'),
    command: 'dotnet nuget locals global-packages --clear',
    note: 'Baixados de novo no próximo dotnet restore.'
  },
  {
    id: 'gradle',
    name: 'Cache do Gradle',
    dir: at(HOME, '.gradle', 'caches'),
    note: 'Baixado de novo no próximo build. Feche o Android Studio antes de limpar.'
  },
  { id: 'maven', name: 'Repositório do Maven', dir: at(HOME, '.m2', 'repository'), note: 'Baixado de novo no próximo build.' },
  { id: 'cargo', name: 'Registro do Cargo', dir: at(HOME, '.cargo', 'registry'), note: 'Baixado de novo no próximo cargo build.' },
  { id: 'go', name: 'Cache de build do Go', dir: at(LOCAL, 'go-build'), command: 'go clean -cache', note: 'Recriado no próximo go build.' },
  { id: 'electron', name: 'Downloads do Electron', dir: at(LOCAL, 'electron', 'Cache'), note: 'Baixado de novo no próximo npm install.' },
  {
    id: 'electron-builder',
    name: 'Cache do electron-builder',
    dir: at(LOCAL, 'electron-builder', 'Cache'),
    note: 'Baixado de novo no próximo build do instalador.'
  }
]

/** Caches smaller than this are not worth a row. */
const MIN_CACHE_BYTES = 1024 * 1024
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000

export interface DevJunkDeps {
  scanner: ScannerHost
  /** The scan on display, when complete. */
  currentScan: () => { root: string; finishedAt: number } | null
  confirm: (e: IpcMainInvokeEvent, options: Electron.MessageBoxOptions) => Promise<boolean>
  isProtectedPath: (path: string) => boolean
  /** Called after the scan tree changed, with the new root totals. */
  afterRemoval: (root: ScanNode) => void
  pruneDuplicates: (path: string) => void
}

/** Runs a fixed cleanup command through cmd (npm, pnpm and yarn are .cmd shims). True on exit code 0. */
function runCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', command], { windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

/** Removes everything inside a folder, permanently. Returns how many entries could not be removed. */
async function emptyFolder(dir: string): Promise<number> {
  let failed = 0
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    try {
      await rm(join(dir, name), { recursive: true, force: false, maxRetries: 2 })
    } catch {
      failed++
    }
  }
  return failed
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The "Lixo de dev" page: finds rebuildable project folders and tool caches, and cleans them. */
export class DevJunkService {
  private last: DevJunkResult | null = null

  constructor(private deps: DevJunkDeps) {}

  get result(): DevJunkResult | null {
    return this.last
  }

  async scan(): Promise<DevJunkResult> {
    const t0 = performance.now()
    const current = this.deps.currentScan()
    const projects = current ? ((await this.deps.scanner.query('devProjects', {})) ?? []) : []
    const caches = await this.measureCaches(current !== null)
    this.last = {
      root: current?.root ?? null,
      scanKey: current?.finishedAt ?? null,
      generatedAt: Date.now(),
      durationMs: Math.round(performance.now() - t0),
      projects,
      caches
    }
    return this.last
  }

  /** Sizes from the scan tree when the cache lies inside it, otherwise a quick walk of the folder. */
  private async measure(dir: string, useTree: boolean): Promise<{ alloc: number; files: number | null } | null> {
    if (useTree) {
      const [inTree] = (await this.deps.scanner.query('sizes', { paths: [dir] })) ?? [null]
      if (typeof inTree === 'number') return { alloc: inTree, files: null }
    }
    return this.deps.scanner.query('folderSize', { path: dir })
  }

  private async measureCaches(haveTree: boolean): Promise<DevCache[]> {
    const out: DevCache[] = []
    for (const def of CACHES) {
      if (!def.dir || !(await isDir(def.dir))) continue
      const size = await this.measure(def.dir, haveTree)
      if (size && size.alloc < MIN_CACHE_BYTES) continue
      out.push({
        id: def.id,
        name: def.name,
        path: def.dir,
        alloc: size?.alloc ?? null,
        files: size?.files ?? null,
        command: def.command ?? null,
        note: def.note
      })
    }
    return out.sort((a, b) => (b.alloc ?? 0) - (a.alloc ?? 0))
  }

  async openFolder(id: unknown): Promise<void> {
    if (typeof id !== 'string' || !this.last) throw new Error('Item not found.')
    const path =
      this.last.projects.find((p) => p.id === id)?.path ?? this.last.caches.find((c) => c.id === id)?.path ?? null
    if (!path) throw new Error('Item not found.')
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  }

  async clean(e: IpcMainInvokeEvent, req: DevCleanRequest, mode: RemoveMode): Promise<DevCleanResult> {
    const nothing: DevCleanResult = { done: false, removed: 0, failed: 0, freed: 0, root: null, notes: [], result: this.last }
    const last = this.last
    if (!last) throw new Error('Atualize a lista antes de limpar.')

    // Only items from the last list can be cleaned: the window cannot name arbitrary folders.
    const wantArtifacts = new Set(Array.isArray(req?.artifacts) ? req.artifacts.filter((n) => Number.isInteger(n)) : [])
    const wantCaches = new Set(Array.isArray(req?.caches) ? req.caches.filter((s) => typeof s === 'string') : [])
    const artifacts = last.projects.flatMap((p) => p.artifacts).filter((a) => wantArtifacts.has(a.nodeId))
    const caches = last.caches.filter((c) => wantCaches.has(c.id))
    if (!artifacts.length && !caches.length) return nothing

    const current = this.deps.currentScan()
    if (artifacts.length && (!current || current.finishedAt !== last.scanKey)) {
      throw new Error('A varredura mudou desde a última lista. Clique em "Atualizar" e tente de novo.')
    }
    for (const a of artifacts) {
      if (this.deps.isProtectedPath(a.path)) throw new Error(`Pasta protegida: ${a.path}`)
    }

    const total = artifacts.reduce((s, a) => s + a.alloc, 0) + caches.reduce((s, c) => s + (c.alloc ?? 0), 0)
    const permanent = mode === 'delete'
    const lines: string[] = []
    if (artifacts.length) {
      lines.push(
        `${plural(artifacts.length, 'pasta de projeto', 'pastas de projeto')} ` +
          (permanent ? 'serão excluídas permanentemente.' : 'vão para a Lixeira.')
      )
    }
    if (caches.length) {
      lines.push(`${plural(caches.length, 'cache', 'caches')} serão limpos direto, sem passar pela Lixeira.`)
    }
    const sample = [...artifacts.map((a) => a.path), ...caches.map((c) => c.path)]
    const listed = sample.slice(0, 6).join('\n') + (sample.length > 6 ? `\n… e mais ${sample.length - 6}` : '')
    const ok = await this.deps.confirm(e, {
      type: permanent ? 'warning' : 'question',
      title: 'Limpar lixo de dev',
      message: `Liberar ${formatBytes(total)}?`,
      detail:
        `${lines.join('\n')}\n\n${listed}\n\n` +
        'Tudo isso é recriado por um comando (npm install, cargo build…). O código dos projetos não é tocado.',
      buttons: [permanent ? 'Excluir permanentemente' : 'Mover para a Lixeira', 'Cancelar']
    })
    if (!ok) return nothing

    let removed = 0
    let failed = 0
    let freed = 0
    let root: ScanNode | null = null
    const notes: string[] = []
    const gone = new Set<number>()

    for (const a of artifacts) {
      try {
        if (permanent) await rm(a.path, { recursive: true, force: false, maxRetries: 2 })
        else await shell.trashItem(a.path)
      } catch {
        failed++
        notes.push(`Não foi possível remover ${a.path}: algum arquivo pode estar em uso (feche o editor ou o servidor de desenvolvimento).`)
        continue
      }
      removed++
      freed += a.alloc
      gone.add(a.nodeId)
      this.deps.pruneDuplicates(a.path)
      const r = await this.deps.scanner.query('remove', { nodeId: a.nodeId })
      if (r) root = r.root
    }

    const cacheSizes = new Map<string, { alloc: number; files: number | null } | null>()
    for (const c of caches) {
      const before = c.alloc ?? 0
      const byCommand = c.command ? await runCommand(c.command) : false
      const leftovers = byCommand ? 0 : await emptyFolder(c.path)
      const after = await this.deps.scanner.query('folderSize', { path: c.path })
      cacheSizes.set(c.id, after)
      freed += Math.max(0, before - (after?.alloc ?? 0))
      if (leftovers > 0) {
        failed++
        notes.push(`${c.name}: ${plural(leftovers, 'item ficou', 'itens ficaram')} para trás (em uso por algum programa).`)
      } else {
        removed++
      }
      // Keep the disk scan in step when the cache lies inside it and is now (nearly) empty.
      if (current && (after?.alloc ?? 0) < before * 0.01) {
        const nodeId = await this.deps.scanner.query('findPath', { path: c.path })
        if (typeof nodeId === 'number' && nodeId >= 0) {
          const r = await this.deps.scanner.query('removeChildren', { nodeId })
          if (r) root = r.root
        }
      }
    }

    if (root) this.deps.afterRemoval(root)

    // The list after cleaning: removed folders go, projects left without folders go, caches get their new size.
    const projects: DevProject[] = last.projects
      .map((p) => {
        const left = p.artifacts.filter((a) => !gone.has(a.nodeId))
        return { ...p, artifacts: left, alloc: left.reduce((s, a) => s + a.alloc, 0) }
      })
      .filter((p) => p.artifacts.length > 0)
    const nextCaches = last.caches
      .map((c) => {
        if (!cacheSizes.has(c.id)) return c
        const size = cacheSizes.get(c.id)
        return { ...c, alloc: size?.alloc ?? null, files: size?.files ?? null }
      })
      .filter((c) => c.alloc === null || c.alloc >= MIN_CACHE_BYTES)
    this.last = { ...last, projects, caches: nextCaches, scanKey: current?.finishedAt ?? last.scanKey }

    return { done: true, removed, failed, freed, root, notes, result: this.last }
  }
}
