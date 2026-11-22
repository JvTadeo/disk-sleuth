/**
 * IPC contract between the main process, the preload and the window.
 * Everything that crosses processes goes through these types: if one side changes, the other stops compiling.
 */

import type {
  ChildrenResult,
  DuplicateProgress,
  DuplicateResult,
  NodeInfo,
  ScanNode,
  ScanProgress,
  ScanSummary,
  TreemapNode
} from './scan'
import type { DetectionResult } from './programs'

export type ThemeSource = 'light' | 'dark' | 'system'

export const THEME_SOURCES: readonly ThemeSource[] = ['light', 'dark', 'system']

export interface ThemeState {
  /** What the user picked. */
  source: ThemeSource
  /** The theme in effect right now ("system" resolved). */
  dark: boolean
}

export interface DriveInfo {
  /** Drive letter, e.g. "C". */
  letter: string
  /** Root path, e.g. "C:\\". */
  root: string
  /** Total bytes. */
  total: number
  /** Bytes free for the current user. */
  free: number
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  platform: string
  /** Time from process start until the window responds, in ms. Null until the window reports in. */
  startupMs: number | null
  /** Running with administrator rights (can read protected folders). */
  isAdmin: boolean
}

export interface CacheInfo {
  root: string
  bytes: number
  savedAt: number
}

/** Actions offered by the right-click menu of a scanned item. */
export type ItemMenuAction = 'enter' | 'explorer' | 'copy' | 'trash' | 'delete' | 'empty'
/** Actions offered by the right-click menu of a program. */
export type ProgramMenuAction = 'uninstall' | 'folder' | 'trash' | 'delete'

export interface DuplicateState {
  running: boolean
  progress: DuplicateProgress | null
  result: DuplicateResult | null
}

/** "trash": to the Recycle Bin; "delete": permanently. */
export type RemoveMode = 'trash' | 'delete'

export interface EmptyResult {
  /** False when the user cancelled. */
  emptied: boolean
  removed: number
  /** Items that could not be removed (in use, protected). */
  failed: number
  /** New totals of the scan root. */
  root: ScanNode | null
}

export interface TrashResult {
  trashed: boolean
  /** New totals of the scan root after the removal. */
  root: ScanNode | null
}

/** Scan status, so a reloaded window can pick up where things are. */
export interface ScanState {
  scanning: boolean
  progress: ScanProgress | null
  summary: ScanSummary | null
}

/** Requests with a reply (ipcRenderer.invoke → ipcMain.handle). Shape: [args, return]. */
export interface InvokeMap {
  'theme:get': [[], ThemeState]
  'theme:set': [[source: ThemeSource], ThemeState]
  'window:isMaximized': [[], boolean]
  'system:listDrives': [[], DriveInfo[]]
  'app:info': [[], AppInfo]
  'app:relaunchAsAdmin': [[scanRoot?: string], { ok: boolean }]
  'report:export': [[], { saved: boolean; path?: string }]
  'scan:start': [[root: string], void]
  'scan:cancel': [[], void]
  'scan:state': [[], ScanState]
  'scan:activate': [[root: string], ScanSummary | null]
  'cache:info': [[], CacheInfo[]]
  'cache:clear': [[root?: string], void]
  'scan:children': [[nodeId: number], ChildrenResult | null]
  'scan:treemap': [[nodeId: number], TreemapNode | null]
  'scan:info': [[nodeId: number], NodeInfo | null]
  'scan:largestFiles': [[], NodeInfo[]]
  'item:showInFolder': [[nodeId: number], void]
  'item:copyPath': [[nodeId: number], void]
  'item:remove': [[nodeId: number, mode: RemoveMode], TrashResult]
  'item:contextMenu': [[nodeId: number], ItemMenuAction | null]
  'item:empty': [[nodeId: number], EmptyResult]
  'programs:contextMenu': [[id: string], ProgramMenuAction | null]
  'programs:icon': [[id: string], string | null]
  'dup:start': [[minSize: number], void]
  'dup:cancel': [[], void]
  'dup:state': [[], DuplicateState]
  'programs:detect': [[], DetectionResult]
  'programs:last': [[], DetectionResult | null]
  'programs:openFolder': [[id: string], void]
  'programs:uninstall': [[id: string], { started: boolean }]
  'programs:remove': [[id: string, mode: RemoveMode], TrashResult]
}

/** Fire-and-forget messages (window → main). */
export interface SendMap {
  'window:minimize': []
  'window:toggleMaximize': []
  'window:close': []
  'app:ready': []
}

/** Events (main → window). */
export interface EventMap {
  'window:maximized': [maximized: boolean]
  'theme:changed': [state: ThemeState]
  'scan:progress': [progress: ScanProgress]
  'scan:done': [summary: ScanSummary]
  'scan:error': [message: string]
  /** The scan on display changed (another drive selected). Null: that drive has no scan yet. */
  'scan:activated': [summary: ScanSummary | null]
  'dup:progress': [progress: DuplicateProgress]
  'dup:done': [result: DuplicateResult]
  'dup:error': [message: string]
}

export type Unsubscribe = () => void

/** API exposed to the window as `window.api`. */
export interface Api {
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizedChange(cb: (maximized: boolean) => void): Unsubscribe
  }
  theme: {
    get(): Promise<ThemeState>
    set(source: ThemeSource): Promise<ThemeState>
    onChange(cb: (state: ThemeState) => void): Unsubscribe
  }
  system: {
    listDrives(): Promise<DriveInfo[]>
  }
  scan: {
    /** Starts scanning a folder or drive root (e.g. "C:\\"). Replaces any previous scan. */
    start(root: string): Promise<void>
    cancel(): Promise<void>
    state(): Promise<ScanState>
    /** One folder level, largest first. Use the summary's rootId for the top level. */
    children(nodeId: number): Promise<ChildrenResult | null>
    /** Two levels below a folder, pruned for drawing. */
    treemap(nodeId: number): Promise<TreemapNode | null>
    info(nodeId: number): Promise<NodeInfo | null>
    /** The 100 largest files of the whole scan. */
    largestFiles(): Promise<NodeInfo[]>
    onProgress(cb: (p: ScanProgress) => void): Unsubscribe
    onDone(cb: (s: ScanSummary) => void): Unsubscribe
    onError(cb: (message: string) => void): Unsubscribe
    /** Shows the saved scan of a root (drive), if any. Ignored while a scan runs. */
    activate(root: string): Promise<ScanSummary | null>
    onActivated(cb: (summary: ScanSummary | null) => void): Unsubscribe
  }
  cache: {
    /** The saved scans, one per drive. */
    info(): Promise<CacheInfo[]>
    /** Deletes one saved scan, or all of them (the scan on screen stays until the app closes). */
    clear(root?: string): Promise<void>
  }
  report: {
    /** Asks where to save (HTML or CSV), writes the report and shows it in Explorer. */
    export(): Promise<{ saved: boolean; path?: string }>
  }
  /** Actions on a scanned item. The main process resolves the path from the id; the window never sends paths. */
  item: {
    showInFolder(nodeId: number): Promise<void>
    copyPath(nodeId: number): Promise<void>
    /** Asks for confirmation in a native dialog, then moves the item to the Recycle Bin or deletes it permanently. */
    remove(nodeId: number, mode: RemoveMode): Promise<TrashResult>
    /** Shows the native right-click menu; resolves with the action the user picked. */
    contextMenu(nodeId: number): Promise<ItemMenuAction | null>
    /** Asks how (Recycle Bin or permanently), then removes everything inside a folder and keeps the folder. */
    empty(nodeId: number): Promise<EmptyResult>
  }
  duplicates: {
    /** Starts looking for identical files of at least `minSize` bytes in the scan on display. */
    start(minSize: number): Promise<void>
    cancel(): Promise<void>
    state(): Promise<DuplicateState>
    onProgress(cb: (p: DuplicateProgress) => void): Unsubscribe
    onDone(cb: (r: DuplicateResult) => void): Unsubscribe
    onError(cb: (message: string) => void): Unsubscribe
  }
  programs: {
    /** Runs detection (a few seconds). Uses the current disk scan for sizes when there is one. */
    detect(): Promise<DetectionResult>
    /** The last detection result, if any. */
    last(): Promise<DetectionResult | null>
    openFolder(id: string): Promise<void>
    /** Confirms in a native dialog, then starts the official uninstaller (or opens Windows Settings for Store apps). */
    uninstall(id: string): Promise<{ started: boolean }>
    /** Confirms in a native dialog, then moves the program's folder to the Recycle Bin or deletes it permanently. */
    remove(id: string, mode: RemoveMode): Promise<TrashResult>
    contextMenu(id: string): Promise<ProgramMenuAction | null>
    /** The program's icon as a data URL, or null. */
    icon(id: string): Promise<string | null>
  }
  app: {
    info(): Promise<AppInfo>
    /** The window reports its first render (measures startup time). */
    ready(): void
    /**
     * Restarts the app with administrator rights (UAC prompt). With a root, the new instance scans it right away.
     * Resolves { ok: false } if the user declined; on success this instance quits.
     */
    relaunchAsAdmin(scanRoot?: string): Promise<{ ok: boolean }>
  }
}
