/**
 * Scan types shared by the scanner process, the main process and the window.
 * Kept free of Node and DOM types so every side can import them.
 */

import type { DevProject } from './devjunk'

export type NodeKind = 'file' | 'dir'

/** One entry as the window sees it: a folder or file with aggregated sizes. */
export interface ScanNode {
  id: number
  name: string
  kind: NodeKind
  /** Logical size in bytes (what "Properties › Size" shows). */
  size: number
  /** Allocated size on disk in bytes ("Size on disk"). Equals `size` when the platform does not report it. */
  alloc: number
  /** Files inside this node, recursively (1 for a file). */
  files: number
  /** True when the node stands for several small entries grouped together (its name is empty). */
  grouped?: boolean
  /** How many entries a grouped node stands for. */
  groupedCount?: number
}

export interface ScanProgress {
  root: string
  files: number
  dirs: number
  /** Bytes counted so far (allocated size when available). */
  bytes: number
  inaccessible: number
  elapsedMs: number
  currentPath: string
}

export interface ScanSummary {
  root: string
  rootId: number
  files: number
  dirs: number
  /** Total logical size in bytes. */
  size: number
  /** Total allocated size in bytes. */
  alloc: number
  /** Whether `alloc` comes from the file system (false: it mirrors `size`). */
  allocSupported: boolean
  /** Extra hard links skipped so their bytes are not counted twice. */
  hardlinksSkipped: number
  /** Symlinks and junctions not followed. */
  linksSkipped: number
  /** Folders that could not be read (access denied and similar). */
  inaccessible: number
  /** A sample of unreadable folders, for display. */
  inaccessibleSample: string[]
  durationMs: number
  /** When the scan finished (epoch ms). */
  finishedAt: number
  /** Number of nodes kept in memory. */
  nodes: number
  cancelled: boolean
  /** Set when this scan was restored from the saved copy instead of run in this session. */
  fromCache?: boolean
  /** Bytes per file category for the whole scan (index = category). */
  categories?: number[]
  /** What changed since the previous scan of the same root, when there was one. */
  diff?: ScanDiff
}

export type ChangeStatus = 'grew' | 'shrank' | 'new' | 'removed'

export interface ScanChange {
  path: string
  name: string
  kind: NodeKind
  before: number
  after: number
  /** after − before, in bytes. */
  delta: number
  status: ChangeStatus
  /** Node id in the current tree (absent for removed items). */
  id?: number
}

export interface ScanDiff {
  /** When the previous scan was taken. */
  previousAt: number
  previousTotal: number
  totalDelta: number
  /** The most significant changes, largest first (by absolute delta). */
  changes: ScanChange[]
}

export interface DuplicateGroup {
  /** Size of each copy, in bytes. */
  size: number
  /** Space that removing all but one copy would free. */
  wasted: number
  files: { id: number; name: string; path: string }[]
}

export interface DuplicateProgress {
  /** "partial": hashing the start and end of each candidate; "full": hashing whole files. */
  phase: 'partial' | 'full'
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  elapsedMs: number
}

export interface DuplicateResult {
  groups: DuplicateGroup[]
  /** Groups found (only the largest are returned). */
  totalGroups: number
  wasted: number
  /** Files that had a same-size twin and were checked. */
  candidates: number
  hashedBytes: number
  durationMs: number
  minSize: number
  cancelled: boolean
  finishedAt: number
}

export interface ChildrenResult {
  parentId: number
  path: string
  /** Ancestors from the root down to (and including) the parent, for breadcrumbs. */
  trail: { id: number; name: string }[]
  parent: ScanNode
  children: ScanNode[]
}

/** A node with its children, for the treemap. Small entries are folded into one grouped child. */
export interface TreemapNode {
  id: number
  name: string
  kind: NodeKind
  alloc: number
  files: number
  grouped?: boolean
  groupedCount?: number
  /** Category index holding the most bytes (see shared/categories). */
  category?: number
  children?: TreemapNode[]
}

/** A node plus where it lives. */
export interface NodeInfo {
  node: ScanNode
  path: string
  trail: { id: number; name: string }[]
  /** Folders only: bytes per category (index = category). */
  categories?: number[]
}

export interface RemoveResult {
  /** The scan root after the removal (new totals). */
  root: ScanNode
}

// ---------- scanner process protocol (main ⇄ scanner) ----------

/** Read/write queries against the tree held by the scanner process. Shape: [params, result]. */
export interface ScannerQueryMap {
  children: [{ nodeId: number; limit: number }, ChildrenResult | null]
  treemap: [{ nodeId: number; depth: number; maxNodes: number }, TreemapNode | null]
  info: [{ nodeId: number }, NodeInfo | null]
  largestFiles: [{ limit: number }, NodeInfo[]]
  remove: [{ nodeId: number }, RemoveResult | null]
  findPath: [{ path: string }, number]
  sizes: [{ paths: string[] }, (number | null)[]]
  /** Writes the tree (and its comparison snapshot) to files, atomically. */
  save: [{ file: string; snapFile: string }, boolean]
  /** Compares the tree with the snapshot of the previous scan. Null when there is none. */
  diff: [{ snapFile: string; previousTotal?: number }, ScanDiff | null]
  /** Replaces the tree with one saved earlier. Queries sent meanwhile wait for it. */
  load: [{ file: string }, boolean]
  /** Rebuildable project folders (node_modules, target…) found in the tree. */
  devProjects: [Record<string, never>, DevProject[]]
  /** Size of a folder outside the tree (walks it with the scan engine). Works without a tree. */
  folderSize: [{ path: string }, { alloc: number; files: number } | null]
  /** Detaches every child of a folder (after it was emptied on disk). */
  removeChildren: [{ nodeId: number }, RemoveResult | null]
}

export type ScannerQuery = {
  [K in keyof ScannerQueryMap]: { kind: K; params: ScannerQueryMap[K][0] }
}[keyof ScannerQueryMap]

export type ScannerRequest =
  | { type: 'scan'; root: string }
  | { type: 'cancel' }
  | { type: 'query'; reqId: number; query: ScannerQuery }
  | { type: 'duplicates'; minSize: number }
  | { type: 'cancelDuplicates' }

export type ScannerMessage =
  | { type: 'progress'; progress: ScanProgress }
  | { type: 'done'; summary: ScanSummary }
  | { type: 'error'; message: string }
  | { type: 'reply'; reqId: number; result: unknown; error?: string }
  | { type: 'dupProgress'; progress: DuplicateProgress }
  | { type: 'dupDone'; result: DuplicateResult }
  | { type: 'dupError'; message: string }
