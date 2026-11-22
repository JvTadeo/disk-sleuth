import { create } from 'zustand'
import type { DriveInfo, ThemeSource, ThemeState } from '@shared/ipc'
import type { ScanNode, ScanProgress, ScanSummary } from '@shared/scan'
import type { DetectionResult } from '@shared/programs'

export type Page = 'overview' | 'disk' | 'programs' | 'settings' | 'scan'

export type ScanStatus = 'idle' | 'scanning' | 'done' | 'cancelled' | 'error'

/** How the treemap colors its cells: by top-level folder, or by file type. */
export type ColorMode = 'folder' | 'type'

interface AppState {
  page: Page
  setPage: (page: Page) => void

  theme: ThemeState
  setTheme: (source: ThemeSource) => Promise<void>
  syncTheme: (state: ThemeState) => void

  drives: DriveInfo[]
  drivesLoaded: boolean
  selectedDrive: string | null
  selectDrive: (letter: string) => void
  loadDrives: () => Promise<void>

  scanStatus: ScanStatus
  scanRoot: string | null
  progress: ScanProgress | null
  summary: ScanSummary | null
  scanError: string | null
  /** Bumped when the tree changes after a scan (e.g. an item went to the Recycle Bin). */
  scanVersion: number
  /** Updates totals after a removal and invalidates cached folder data. */
  applyRemoval: (root: ScanNode | null) => void
  /** Puts a (possibly null) scan on display, unless a scan is running. */
  showScanOf: (summary: ScanSummary | null) => void
  /** Subscribes to scanner events and restores the current state. Returns the unsubscribe function. */
  initScan: () => () => void
  startScan: (root: string) => Promise<void>
  cancelScan: () => Promise<void>

  colorMode: ColorMode
  setColorMode: (mode: ColorMode) => void
  /** A node the Disk page should reveal when it opens (from Overview links). */
  diskFocus: number | null
  openInDisk: (nodeId: number) => void
  clearDiskFocus: () => void

  isAdmin: boolean
  loadAppInfo: () => Promise<void>
  /** Restarts elevated (UAC). With a root, the new instance scans it right away. Returns false if declined. */
  relaunchAsAdmin: (scanRoot?: string) => Promise<boolean>
  /** Saves an HTML/CSV report; returns the saved path, or null if cancelled. */
  exportReport: () => Promise<string | null>

  programs: DetectionResult | null
  detecting: boolean
  programsError: string | null
  detectPrograms: () => Promise<void>
  /** Removes a program from the list after its folder went to the Recycle Bin. */
  forgetProgram: (id: string) => void
}

/** Applies the theme to the document. Called before the first render and on every change. */
export function applyTheme(dark: boolean): void {
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
}

const initialDark = new URLSearchParams(location.search).get('theme') === 'dark'

export const useApp = create<AppState>((set, get) => ({
  page: 'overview',
  setPage: (page) => set({ page }),

  theme: { source: 'system', dark: initialDark },
  setTheme: async (source) => {
    // Optimistic update: the option is checked right away; the real theme arrives via theme:changed.
    set({ theme: { ...get().theme, source } })
    get().syncTheme(await window.api.theme.set(source))
  },
  syncTheme: (state) => {
    applyTheme(state.dark)
    set({ theme: state })
  },

  drives: [],
  drivesLoaded: false,
  selectedDrive: null,
  selectDrive: (letter) => {
    // Picking a drive opens it on the Disk page, with its own saved scan if there is one.
    set({ selectedDrive: letter, page: 'disk' })
    const drive = get().drives.find((d) => d.letter === letter)
    if (drive && get().scanStatus !== 'scanning') void window.api.scan.activate(drive.root).then(get().showScanOf)
  },
  loadDrives: async () => {
    const drives = await window.api.system.listDrives()
    const current = get().selectedDrive
    const scanned = driveForRoot(drives, get().summary?.root ?? null)
    set({
      drives,
      drivesLoaded: true,
      selectedDrive:
        current && drives.some((d) => d.letter === current)
          ? current
          : (scanned?.letter ?? drives[0]?.letter ?? null)
    })
  },

  scanStatus: 'idle',
  scanRoot: null,
  progress: null,
  summary: null,
  scanError: null,
  scanVersion: 0,
  showScanOf: (summary) => {
    if (get().scanStatus === 'scanning') return
    const drive = driveForRoot(get().drives, summary?.root ?? null)
    set({
      summary,
      scanRoot: summary?.root ?? null,
      scanStatus: summary ? (summary.cancelled ? 'cancelled' : 'done') : 'idle',
      ...(drive ? { selectedDrive: drive.letter } : {})
    })
  },
  applyRemoval: (root) => {
    const { summary, scanVersion } = get()
    set({
      scanVersion: scanVersion + 1,
      summary: summary && root ? { ...summary, alloc: root.alloc, size: root.size, files: root.files } : summary
    })
  },
  initScan: () => {
    const offs = [
      window.api.scan.onProgress((progress) => set({ progress, scanRoot: progress.root })),
      window.api.scan.onDone((summary) => {
        set({ summary, scanStatus: summary.cancelled ? 'cancelled' : 'done', scanRoot: summary.root })
        // Programs detected before this scan have estimated sizes only: refresh them with real ones.
        const programs = get().programs
        if (!summary.cancelled && programs && programs.supported && !programs.usedScan) void get().detectPrograms()
      }),
      window.api.scan.onError((scanError) => set({ scanError, scanStatus: 'error' })),
      window.api.scan.onActivated((summary) => get().showScanOf(summary))
    ]
    void window.api.programs.last().then((programs) => programs && set({ programs }))
    void window.api.scan.state().then((st) => {
      // A scan already running at startup was requested by an elevation relaunch: show its progress.
      if (st.scanning) set({ scanStatus: 'scanning', progress: st.progress, scanRoot: st.progress?.root ?? null, page: 'scan' })
      else if (st.summary) get().showScanOf(st.summary)
    })
    return () => offs.forEach((off) => off())
  },
  startScan: async (root) => {
    const drive = driveForRoot(get().drives, root)
    set({
      scanStatus: 'scanning',
      scanRoot: root,
      progress: null,
      summary: null,
      scanError: null,
      page: 'scan',
      ...(drive ? { selectedDrive: drive.letter } : {})
    })
    try {
      await window.api.scan.start(root)
    } catch (err) {
      set({ scanStatus: 'error', scanError: err instanceof Error ? err.message : String(err) })
    }
  },
  cancelScan: async () => {
    await window.api.scan.cancel()
  },

  colorMode: 'folder',
  setColorMode: (colorMode) => set({ colorMode }),
  diskFocus: null,
  openInDisk: (nodeId) => set({ diskFocus: nodeId, page: 'disk' }),
  clearDiskFocus: () => set({ diskFocus: null }),

  isAdmin: false,
  loadAppInfo: async () => {
    const info = await window.api.app.info()
    set({ isAdmin: info.isAdmin })
  },
  relaunchAsAdmin: async (scanRoot) => (await window.api.app.relaunchAsAdmin(scanRoot)).ok,
  exportReport: async () => {
    const r = await window.api.report.export()
    return r.saved ? (r.path ?? null) : null
  },

  programs: null,
  detecting: false,
  programsError: null,
  detectPrograms: async () => {
    if (get().detecting) return
    set({ detecting: true, programsError: null })
    try {
      set({ programs: await window.api.programs.detect() })
    } catch (err) {
      set({ programsError: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ detecting: false })
    }
  },
  forgetProgram: (id) => {
    const programs = get().programs
    if (programs) set({ programs: { ...programs, programs: programs.programs.filter((p) => p.id !== id) } })
  }
}))

/** Programs that deserve a look: not registered or orphaned (system components excluded). */
export function useAttentionCount(): number {
  return useApp((s) => s.programs?.programs.filter((p) => !p.hidden && p.status !== 'reg').length ?? 0)
}

/** The drive a scan root belongs to, when the root is a whole drive. */
export function driveForRoot(drives: DriveInfo[], root: string | null): DriveInfo | undefined {
  return root ? drives.find((d) => d.root.toLowerCase() === root.toLowerCase()) : undefined
}

/** Short drive name: "C:" (or "/" outside Windows). */
export function driveShort(d: DriveInfo): string {
  return d.letter === '/' ? '/' : `${d.letter}:`
}

export function driveLabel(d: DriveInfo): string {
  if (d.letter === '/') return 'Disco do sistema'
  return d.letter === 'C' ? `Disco local (C:)` : `Unidade (${d.letter}:)`
}

/** Cache key for anything read from the current scan tree; undefined when there is no scan. */
export function useScanKey(): string | undefined {
  const finishedAt = useApp((s) => s.summary?.finishedAt)
  const version = useApp((s) => s.scanVersion)
  return finishedAt === undefined ? undefined : `${finishedAt}:${version}`
}
