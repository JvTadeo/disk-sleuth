import { spawn } from 'node:child_process'
import { access, readdir, rm, writeFile } from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { THEME_SOURCES, type EventMap, type InvokeMap, type SendMap, type ThemeSource, type ThemeState } from '@shared/ipc'
import { listDrives } from './drives'
import { getSettings, updateSettings } from './settings'
import { getStartupMs, markReady } from './perf'
import { ScannerHost } from './scanner-host'
import type { DuplicateProgress, DuplicateResult, NodeInfo, ScanProgress, ScanSummary } from '@shared/scan'
import type { ItemMenuAction, ProgramMenuAction, RemoveMode } from '@shared/ipc'
import { formatBytes, formatInt } from '@shared/format'
import type { Program } from '@shared/programs'
import { ProgramDetector } from './detector'
import { buildCsv, buildHtml, type ReportData } from './report'
import { argValue, FLAGS, isAdmin, markHandedOff, relaunchElevated } from './elevation'
import {
  cacheFile,
  cacheInfo,
  clearCache,
  getActiveRoot,
  prepareCacheDir,
  readCacheMeta,
  setActiveRoot,
  snapshotFile,
  writeCacheMeta
} from './cache'

// ---------- typed helpers ----------

function handle<K extends keyof InvokeMap>(
  channel: K,
  fn: (event: IpcMainInvokeEvent, ...args: InvokeMap[K][0]) => InvokeMap[K][1] | Promise<InvokeMap[K][1]>
): void {
  ipcMain.handle(channel, (event, ...args) => fn(event, ...(args as InvokeMap[K][0])))
}

function on<K extends keyof SendMap>(channel: K, fn: (event: IpcMainEvent, ...args: SendMap[K]) => void): void {
  ipcMain.on(channel, (event, ...args) => fn(event, ...(args as SendMap[K])))
}

export function emit<K extends keyof EventMap>(win: BrowserWindow, channel: K, ...args: EventMap[K]): void {
  if (!win.isDestroyed()) win.webContents.send(channel, ...args)
}

export function broadcast<K extends keyof EventMap>(channel: K, ...args: EventMap[K]): void {
  for (const win of BrowserWindow.getAllWindows()) emit(win, channel, ...args)
}

const senderWindow = (e: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(e.sender)

export function themeState(): ThemeState {
  return { source: getSettings().theme, dark: nativeTheme.shouldUseDarkColors }
}

// ---------- scanner ----------

let lastProgress: ScanProgress | null = null
let lastSummary: ScanSummary | null = null
let dupRunning = false
let dupProgress: DuplicateProgress | null = null
let dupResult: DuplicateResult | null = null

/** Duplicate results belong to one tree: forget them when the tree changes. */
function resetDuplicates(): void {
  if (dupRunning) scanner.cancelDuplicates()
  dupRunning = false
  dupProgress = null
  dupResult = null
}

/** Drops removed paths (a file, or everything under a folder) from the duplicate results. */
function pruneDuplicates(removedPath: string): void {
  if (!dupResult) return
  const lower = removedPath.toLowerCase()
  const gone = (p: string): boolean => {
    const l = p.toLowerCase()
    return l === lower || l.startsWith(lower + '\\') || l.startsWith(lower + '/')
  }
  const groups = dupResult.groups
    .map((g) => ({ ...g, files: g.files.filter((f) => !gone(f.path)) }))
    .filter((g) => g.files.length > 1)
    .map((g) => ({ ...g, wasted: (g.wasted / Math.max(1, g.files.length)) * (g.files.length - 1) }))
  dupResult = { ...dupResult, groups, wasted: groups.reduce((a, g) => a + g.wasted, 0) }
}

export const scanner = new ScannerHost({
  onProgress: (p) => {
    lastProgress = p
    broadcast('scan:progress', p)
  },
  onDone: (s) => void finishScan(s),
  onError: (message) => broadcast('scan:error', message),
  onDupProgress: (p) => {
    dupProgress = p
    broadcast('dup:progress', p)
  },
  onDupDone: (r) => {
    dupRunning = false
    dupResult = r
    broadcast('dup:done', r)
  },
  onDupError: (message) => {
    dupRunning = false
    broadcast('dup:error', message)
  }
})

/** A scan ended: compare with the previous scan of the same root, publish, then save (which replaces the baseline). */
async function finishScan(s: ScanSummary): Promise<void> {
  let summary = s
  if (!s.cancelled) {
    try {
      const previous = readCacheMeta(s.root)
      const diff = await scanner.query('diff', { snapFile: snapshotFile(s.root), previousTotal: previous?.alloc })
      if (diff) summary = { ...s, diff }
    } catch (err) {
      console.error('[diff] failed:', err)
    }
  }
  lastSummary = summary
  broadcast('scan:done', summary)
  if (!summary.cancelled) void saveCache()
}

function summaryAfterRemoval(root: { alloc: number; size: number; files: number } | undefined): void {
  if (root && lastSummary) lastSummary = { ...lastSummary, alloc: root.alloc, size: root.size, files: root.files }
  scheduleCacheSave()
}

// ---------- scan cache ----------

let saving: Promise<void> = Promise.resolve()
let saveTimer: NodeJS.Timeout | null = null

/** Saves the current tree; saves run one after another. */
function saveCache(): Promise<void> {
  saving = saving
    .then(async () => {
      const summary = lastSummary
      if (!summary || summary.cancelled) return
      await prepareCacheDir()
      const t0 = performance.now()
      if (await scanner.query('save', { file: cacheFile(summary.root), snapFile: snapshotFile(summary.root) })) {
        await writeCacheMeta(summary)
        console.log(`[cache] saved in ${Math.round(performance.now() - t0)} ms`)
      }
    })
    .catch((err) => console.error('[cache] save failed:', err))
  return saving
}

/** After removals, save once things settle instead of after every click. */
function scheduleCacheSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveCache(), 3000)
}

/** Writes any pending save now (before the tree in the scanner process is replaced). */
async function flushCacheSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    await saveCache()
  } else {
    await saving
  }
}

/**
 * Shows the saved scan of a root (a drive the user selected). The summary is available at once;
 * the tree loads in the background in the scanner process and queries wait for it.
 * Returns the summary now in effect (null: no scan of that root yet).
 */
export async function activateRoot(root: string): Promise<ScanSummary | null> {
  if (scanner.isScanning) return lastSummary // never swap trees under a running scan
  if (lastSummary?.root === root) return lastSummary
  await flushCacheSave()
  resetDuplicates()
  void setActiveRoot(root).catch(() => {})
  const summary = readCacheMeta(root)
  lastSummary = summary
  if (summary) {
    void scanner.query('load', { file: cacheFile(root) }).then((ok) => {
      if (ok) return
      console.error(`[cache] could not load the saved scan of ${root}; discarding it`)
      if (lastSummary?.root === root) {
        lastSummary = null
        broadcast('scan:activated', null)
      }
      void clearCache(root)
    })
  }
  broadcast('scan:activated', summary)
  return summary
}

/** At startup: show the scan of the drive used last. */
export function restoreCachedScan(): void {
  void prepareCacheDir().catch(() => {})
  const root = getActiveRoot()
  if (root) void activateRoot(root)
}

export const detector = new ProgramDetector({
  sizes: async (paths) => (lastSummary && !lastSummary.cancelled ? scanner.query('sizes', { paths }) : null)
})

function requireProgram(id: unknown): Program {
  const p = typeof id === 'string' ? detector.get(id) : undefined
  if (!p) throw new Error('Program not found in the last detection.')
  return p
}

async function confirm(e: IpcMainInvokeEvent, options: Electron.MessageBoxOptions): Promise<boolean> {
  const win = senderWindow(e)
  const opts: Electron.MessageBoxOptions = { cancelId: 1, defaultId: 1, noLink: true, ...options }
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  return response === 0
}

async function assertScannableFolder(root: unknown): Promise<string> {
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('Scan root must be an absolute path.')
  const st = await stat(root)
  if (!st.isDirectory()) throw new Error(`Not a folder: ${root}`)
  return root
}

/** Max entries sent to the window per folder; the rest is grouped into one row. */
const CHILDREN_LIMIT = 500
/** Treemap: two levels deep, capped so drawing cost stays flat on huge folders. */
const TREEMAP_DEPTH = 2
const TREEMAP_MAX_NODES = 3000
const LARGEST_FILES = 100

function assertNodeId(nodeId: unknown): number {
  if (typeof nodeId !== 'number' || !Number.isInteger(nodeId) || nodeId < 0) throw new Error('Invalid node id.')
  return nodeId
}

async function requireInfo(nodeId: unknown): Promise<NodeInfo> {
  const info = await scanner.query('info', { nodeId: assertNodeId(nodeId) })
  if (!info) throw new Error('Item not found in the current scan.')
  return info
}

/** Folders whose removal can break Windows or installed programs. */
function isSystemPath(p: string): boolean {
  const lower = p.toLowerCase()
  const roots = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]
  return roots.some((r) => !!r && (lower === r.toLowerCase() || lower.startsWith(r.toLowerCase() + '\\')))
}

/** Handles --scan-root=<path> (passed by an elevation relaunch). Returns true when a scan started. */
export async function startScanFromArgs(): Promise<boolean> {
  const root = argValue(FLAGS.scanRoot)
  if (!root) return false
  try {
    scanner.start(await assertScannableFolder(root))
    return true
  } catch (err) {
    console.error('[scan] ignoring --scan-root:', err)
    return false
  }
}

// ---------- context menus ----------

const iconCache = new Map<string, string | null>()

type MenuEntry<A> = { label: string; action: A; accelerator?: string; enabled?: boolean } | null

/** Shows a native menu at the cursor and resolves with the chosen action (null when dismissed). */
function popupMenu<A extends string>(e: IpcMainInvokeEvent, entries: MenuEntry<A>[]): Promise<A | null> {
  return new Promise((resolve) => {
    let chosen = false
    const menu = Menu.buildFromTemplate(
      entries.map((it) =>
        it
          ? {
              label: it.label,
              enabled: it.enabled ?? true,
              accelerator: it.accelerator,
              registerAccelerator: false, // shown as a hint only; the window handles the keys
              click: () => {
                chosen = true
                resolve(it.action)
              }
            }
          : { type: 'separator' as const }
      )
    )
    const win = senderWindow(e) ?? undefined
    menu.popup({
      window: win,
      // Fires when the menu closes; a click (if any) is delivered just before or after, so wait a moment.
      callback: () => setTimeout(() => !chosen && resolve(null), 50)
    })
  })
}

// ---------- removing things ----------

/** Paths never removed from the app, whatever the user clicks. */
function isProtectedPath(p: string): boolean {
  const l = p.toLowerCase().replace(/[\\/]+$/, '')
  if (/^[a-z]:$/.test(l) || l === '') return true // drive roots
  const exact = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData, process.env.USERPROFILE,
    process.env.APPDATA, process.env.LOCALAPPDATA]
  if (exact.some((r) => r && l === r.toLowerCase())) return true
  const sys = process.env.SystemRoot?.toLowerCase()
  return !!sys && (l === sys || l.startsWith(sys + '\\'))
}

/**
 * Asks for confirmation (native dialog, Cancel by default) and removes a path:
 * to the Recycle Bin, or permanently. Returns false when the user cancelled.
 */
async function removeWithConfirm(
  e: IpcMainInvokeEvent,
  item: { name: string; path: string; sizeText: string; note?: string },
  mode: RemoveMode
): Promise<boolean> {
  if (isProtectedPath(item.path)) throw new Error('This folder is protected and cannot be removed from the app.')
  const risky = isSystemPath(item.path)
  const warning = risky
    ? 'Atenção: este item faz parte do Windows ou de programas instalados. Removê-lo pode quebrar o sistema ou programas.'
    : (item.note ?? '')
  const ok =
    mode === 'trash'
      ? await confirm(e, {
          type: risky ? 'warning' : 'question',
          title: 'Mover para a Lixeira',
          message: `Mover "${item.name}" para a Lixeira?`,
          detail: `${item.path}\n${item.sizeText}\n\n${warning || 'Você pode restaurar pela Lixeira do Windows.'}`,
          buttons: ['Mover para a Lixeira', 'Cancelar']
        })
      : await confirm(e, {
          type: 'warning',
          title: 'Excluir permanentemente',
          message: `Excluir "${item.name}" permanentemente?`,
          detail:
            `${item.path}\n${item.sizeText}\n\n` +
            'Esta ação não pode ser desfeita: os arquivos não vão para a Lixeira.' +
            (warning ? `\n\n${warning}` : ''),
          buttons: ['Excluir permanentemente', 'Cancelar']
        })
  if (!ok) return false
  if (mode === 'trash') {
    await shell.trashItem(item.path)
  } else {
    try {
      await rm(item.path, { recursive: true, force: false, maxRetries: 2 })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'erro'
      throw new Error(
        `Não foi possível excluir tudo (${code}): algum arquivo pode estar em uso ou protegido. Escaneie de novo para atualizar os tamanhos.`
      )
    }
  }
  return true
}

// ---------- registration ----------

export function registerIpc(): void {
  // Window
  on('window:minimize', (e) => senderWindow(e)?.minimize())
  on('window:toggleMaximize', (e) => {
    const w = senderWindow(e)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  on('window:close', (e) => senderWindow(e)?.close())
  handle('window:isMaximized', (e) => senderWindow(e)?.isMaximized() ?? false)

  // Theme
  handle('theme:get', () => themeState())
  handle('theme:set', (_e, source: ThemeSource) => {
    // Never trust input from the window: validate before use.
    if (!THEME_SOURCES.includes(source)) throw new Error(`Invalid theme: ${String(source)}`)
    updateSettings({ theme: source })
    nativeTheme.themeSource = source // fires nativeTheme 'updated', which notifies the windows
    return themeState()
  })

  // System
  handle('system:listDrives', () => listDrives())

  // Scanner
  handle('scan:start', async (_e, root) => {
    const folder = await assertScannableFolder(root)
    await flushCacheSave()
    resetDuplicates()
    lastProgress = null
    lastSummary = null
    void setActiveRoot(folder).catch(() => {})
    scanner.start(folder)
  })
  handle('scan:activate', (_e, root) => {
    if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('Root must be an absolute path.')
    return activateRoot(root)
  })
  handle('scan:cancel', () => scanner.cancel())
  handle('cache:info', () => cacheInfo())
  handle('cache:clear', (_e, root) => clearCache(typeof root === 'string' ? root : undefined))
  handle('scan:state', () => ({ scanning: scanner.isScanning, progress: lastProgress, summary: lastSummary }))
  handle('scan:children', (_e, nodeId) => scanner.query('children', { nodeId: assertNodeId(nodeId), limit: CHILDREN_LIMIT }))
  handle('scan:treemap', (_e, nodeId) =>
    scanner.query('treemap', { nodeId: assertNodeId(nodeId), depth: TREEMAP_DEPTH, maxNodes: TREEMAP_MAX_NODES })
  )
  handle('scan:info', (_e, nodeId) => scanner.query('info', { nodeId: assertNodeId(nodeId) }))
  handle('scan:largestFiles', async () => (await scanner.query('largestFiles', { limit: LARGEST_FILES })) ?? [])

  // Item actions: paths always come from the scanner, never from the window.
  handle('item:showInFolder', async (_e, nodeId) => {
    shell.showItemInFolder((await requireInfo(nodeId)).path)
  })
  handle('item:copyPath', async (_e, nodeId) => {
    clipboard.writeText((await requireInfo(nodeId)).path)
  })
  handle('item:remove', async (e, nodeId, mode) => {
    const info = await requireInfo(nodeId)
    if (info.trail.length <= 1) throw new Error('The scan root cannot be removed.')
    const { node, path } = info
    const sizeText = node.kind === 'dir' ? `${formatBytes(node.alloc)} em ${formatInt(node.files)} arquivos` : formatBytes(node.alloc)
    const done = await removeWithConfirm(e, { name: node.name, path, sizeText }, mode === 'delete' ? 'delete' : 'trash')
    if (!done) return { trashed: false, root: null }
    const result = await scanner.query('remove', { nodeId: node.id })
    summaryAfterRemoval(result?.root)
    pruneDuplicates(path)
    return { trashed: true, root: result?.root ?? null }
  })

  // Empty a folder: remove everything inside it, keep the folder itself.
  handle('item:empty', async (e, nodeId) => {
    const info = await requireInfo(nodeId)
    const { node, path } = info
    if (node.kind !== 'dir') throw new Error('Only folders can be emptied.')
    if (isProtectedPath(path)) throw new Error('This folder is protected and cannot be emptied from the app.')
    const risky = isSystemPath(path)
    const win = senderWindow(e)
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Esvaziar pasta',
      message: `Esvaziar "${node.name}"?`,
      detail:
        `${path}\n${formatBytes(node.alloc)} em ${formatInt(node.files)} arquivos\n\n` +
        'Tudo o que está dentro será removido; a pasta continua existindo.' +
        (risky ? '\n\nAtenção: esta pasta faz parte do Windows ou de programas instalados. Esvaziá-la pode quebrar o sistema ou programas.' : ''),
      buttons: ['Mover conteúdo para a Lixeira', 'Excluir conteúdo permanentemente', 'Cancelar'],
      defaultId: 2,
      cancelId: 2,
      noLink: true
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response === 2) return { emptied: false, removed: 0, failed: 0, root: null }
    const permanent = response === 1

    // Read the folder as it is now (it may hold items created after the scan).
    const entries = await readdir(path).catch(() => [] as string[])
    let removed = 0
    let failed = 0
    let root = null
    for (const name of entries) {
      const full = join(path, name)
      try {
        if (permanent) await rm(full, { recursive: true, force: false, maxRetries: 2 })
        else await shell.trashItem(full)
        removed++
      } catch {
        failed++
        continue
      }
      pruneDuplicates(full)
      const childId = await scanner.query('findPath', { path: full })
      if (typeof childId === 'number' && childId >= 0) {
        const r = await scanner.query('remove', { nodeId: childId })
        if (r) root = r.root
      }
    }
    if (root) summaryAfterRemoval(root)
    return { emptied: true, removed, failed, root }
  })

  // Right-click menu: native, so it looks and behaves like Windows. The window performs the chosen action.
  handle('item:contextMenu', async (e, nodeId) => {
    const info = await requireInfo(nodeId)
    const isRoot = info.trail.length <= 1
    const removable = !isRoot && !isProtectedPath(info.path)
    return popupMenu<ItemMenuAction>(e, [
      ...(info.node.kind === 'dir' && info.node.files > 0 ? [{ label: 'Entrar', action: 'enter' as const }, null] : []),
      { label: 'Abrir no Explorer', action: 'explorer' },
      { label: 'Copiar caminho', action: 'copy' },
      null,
      { label: 'Mover para a Lixeira', action: 'trash', accelerator: 'Delete', enabled: removable },
      { label: 'Excluir permanentemente', action: 'delete', accelerator: 'Shift+Delete', enabled: removable },
      ...(info.node.kind === 'dir'
        ? [null, { label: 'Esvaziar pasta…', action: 'empty' as const, enabled: !isProtectedPath(info.path) && info.node.files > 0 }]
        : [])
    ])
  })

  // Programs
  handle('programs:detect', async () => detector.detect(await listDrives()))
  handle('programs:last', () => detector.result)
  handle('programs:openFolder', async (_e, id) => {
    const p = requireProgram(id)
    if (!p.location) throw new Error('This program has no known folder.')
    const err = await shell.openPath(p.location)
    if (err) throw new Error(err)
  })
  handle('programs:uninstall', async (e, id) => {
    const p = requireProgram(id)
    if (!p.canUninstall) throw new Error('This program cannot be uninstalled from here.')
    if (p.kind === 'store') {
      // Store apps are removed through Windows Settings, which handles dependencies and user data.
      await shell.openExternal('ms-settings:appsfeatures')
      return { started: true }
    }
    const cmd = detector.uninstallCommand(p.id)
    if (!cmd) throw new Error('No uninstaller registered for this program.')
    const ok = await confirm(e, {
      type: 'question',
      title: 'Desinstalar programa',
      message: `Desinstalar "${p.name}"?`,
      detail: 'O desinstalador oficial do programa vai abrir. Siga os passos dele e depois clique em "Atualizar lista".',
      buttons: ['Desinstalar', 'Cancelar']
    })
    if (!ok) return { started: false }
    // "start" goes through ShellExecute, so uninstallers that need administrator rights get the UAC prompt.
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "" ${cmd}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true
    })
    child.unref()
    return { started: true }
  })
  handle('programs:remove', async (e, id, mode) => {
    const p = requireProgram(id)
    if (!p.canTrash || !p.location) throw new Error('This folder cannot be removed from here.')
    const note =
      p.status === 'orphan'
        ? 'A pasta parece ser resto de um programa que não está mais instalado.'
        : 'Este programa não tem desinstalador registrado, então a pasta dele vai inteira.'
    const done = await removeWithConfirm(
      e,
      { name: p.name, path: p.location, sizeText: p.size !== undefined ? formatBytes(p.size) : '', note },
      mode === 'delete' ? 'delete' : 'trash'
    )
    if (!done) return { trashed: false, root: null }
    detector.forget(p.id)
    pruneDuplicates(p.location)
    let root = null
    const nodeId = await scanner.query('findPath', { path: p.location })
    if (typeof nodeId === 'number' && nodeId >= 0) {
      const r = await scanner.query('remove', { nodeId })
      summaryAfterRemoval(r?.root)
      root = r?.root ?? null
    }
    return { trashed: true, root }
  })

  handle('programs:contextMenu', (e, id) => {
    const p = requireProgram(id)
    return popupMenu<ProgramMenuAction>(e, [
      ...(p.canUninstall ? [{ label: p.kind === 'store' ? 'Abrir nas Configurações' : 'Desinstalar', action: 'uninstall' as const }] : []),
      ...(p.location && p.reason !== 'registryMissingFolder' ? [{ label: 'Abrir pasta', action: 'folder' as const }] : []),
      ...(p.canTrash
        ? [
            null,
            { label: 'Mover para a Lixeira', action: 'trash' as const },
            { label: 'Excluir permanentemente', action: 'delete' as const }
          ]
        : [])
    ])
  })

  // Program icons, taken from the program's own executable. Cached for the session.
  handle('programs:icon', async (_e, id) => {
    const p = requireProgram(id)
    if (!p.iconPath) return null
    if (iconCache.has(p.iconPath)) return iconCache.get(p.iconPath)!
    let url: string | null = null
    try {
      await access(p.iconPath) // a missing file would get Windows' generic icon: use the app's fallback instead
      const img = await app.getFileIcon(p.iconPath, { size: 'normal' })
      url = img.isEmpty() ? null : img.toDataURL()
    } catch {
      url = null
    }
    iconCache.set(p.iconPath, url)
    return url
  })

  // Duplicates
  handle('dup:start', (_e, minSize) => {
    const size = typeof minSize === 'number' && minSize > 0 ? Math.floor(minSize) : 1024 * 1024
    if (!lastSummary) throw new Error('Run a scan first.')
    if (!scanner.startDuplicates(size)) throw new Error('No scan loaded.')
    dupRunning = true
    dupProgress = null
    dupResult = null
  })
  handle('dup:cancel', () => scanner.cancelDuplicates())
  handle('dup:state', () => ({ running: dupRunning, progress: dupProgress, result: dupResult }))

  // Report
  handle('report:export', async (e) => {
    const summary = lastSummary && !lastSummary.cancelled ? lastSummary : null
    const programs = detector.result?.supported ? detector.result.programs.filter((p) => !p.hidden) : null
    if (!summary && !programs) throw new Error('Nothing to export yet: run a scan or detect programs first.')

    const top = summary ? await scanner.query('children', { nodeId: summary.rootId, limit: 50 }) : null
    const largest = summary ? await scanner.query('largestFiles', { limit: LARGEST_FILES }) : null
    const data: ReportData = {
      generatedAt: Date.now(),
      summary,
      topItems: top?.children ?? [],
      largestFiles: largest ?? [],
      programs
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const win = senderWindow(e)
    const options: Electron.SaveDialogOptions = {
      title: 'Exportar relatório',
      defaultPath: join(app.getPath('documents'), `relatorio-disco-${stamp}.html`),
      filters: [
        { name: 'Relatório (HTML)', extensions: ['html'] },
        { name: 'Planilha (CSV)', extensions: ['csv'] }
      ]
    }
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (canceled || !filePath) return { saved: false }
    const csv = extname(filePath).toLowerCase() === '.csv'
    await writeFile(filePath, csv ? buildCsv(data) : buildHtml(data), 'utf8')
    shell.showItemInFolder(filePath)
    return { saved: true, path: filePath }
  })

  handle('app:relaunchAsAdmin', async (_e, scanRoot) => {
    const root = scanRoot === undefined ? undefined : await assertScannableFolder(scanRoot)
    const r = await relaunchElevated(root)
    if (!r.ok) return { ok: false }
    const devServer = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
    // Let the reply reach the window before it goes away.
    setTimeout(() => {
      if (!devServer) {
        app.quit()
        return
      }
      // Dev mode: the Vite dev server lives as long as this process, and the elevated copy loads its UI
      // from it. So hand the single-instance lock over, close the windows, and stay alive (windowless)
      // until the elevated copy exits.
      markHandedOff()
      scanner.dispose()
      app.releaseSingleInstanceLock()
      for (const w of BrowserWindow.getAllWindows()) w.destroy()
      void r.exited.then(() => app.quit())
    }, 100)
    return { ok: true }
  })
  handle('app:info', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    startupMs: getStartupMs(),
    isAdmin: await isAdmin()
  }))
  on('app:ready', () => markReady())
}
