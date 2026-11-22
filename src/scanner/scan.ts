import { lstat, readdir } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { Dirent, Stats } from 'node:fs'
import type { ScanProgress, ScanSummary } from '../shared/scan'
import { ScanTree } from './tree'
import { categoryOf } from './categories'

export interface ScanOptions {
  /** Folders processed at the same time. Defaults (32 × 16 with a 32-thread pool) were tuned on a
   *  1.2M-file NTFS SSD: 23k files/s versus 8k files/s with 16 × 8 and 16 threads. */
  dirWorkers?: number
  /** lstat calls in flight per folder. */
  statConcurrency?: number
  signal?: AbortSignal
  /** Called with a live snapshot; the caller decides how often to read it. */
  onProgress?: (p: ScanProgress) => void
  progressIntervalMs?: number
}

export interface ScanResult {
  tree: ScanTree
  summary: ScanSummary
}

const INACCESSIBLE_SAMPLE = 50

/**
 * Walks a folder tree and builds a ScanTree.
 *
 * - Parallel: N folder workers, each stating its files with bounded concurrency.
 *   libuv runs fs calls on its thread pool, so callers should raise UV_THREADPOOL_SIZE.
 * - Depth-first work stack: memory stays proportional to tree depth × width, not to the whole disk.
 * - Never follows symlinks or junctions (some Windows junctions point at their own parent and loop forever).
 * - Counts a hard-linked file once (C:\Windows\WinSxS would otherwise look tens of GB bigger).
 * - Uses the allocated size ("size on disk") when the file system reports it.
 */
export async function scan(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const dirWorkers = opts.dirWorkers ?? 32
  const statConcurrency = opts.statConcurrency ?? 16
  const signal = opts.signal

  const started = performance.now()
  const tree = new ScanTree()
  const rootId = tree.add(-1, root, 'dir')

  const stack: { id: number; path: string }[] = [{ id: rootId, path: root }]
  const seenInodes = new Set<bigint>()

  let files = 0
  let dirs = 1
  let bytes = 0
  let logical = 0
  let allocated = 0
  let hardlinksSkipped = 0
  let linksSkipped = 0
  let inaccessible = 0
  const inaccessibleSample: string[] = []
  let currentPath = root

  const snapshot = (): ScanProgress => ({
    root,
    files,
    dirs,
    bytes,
    inaccessible,
    elapsedMs: Math.round(performance.now() - started),
    currentPath
  })

  const timer = opts.onProgress
    ? setInterval(() => opts.onProgress!(snapshot()), opts.progressIntervalMs ?? 100)
    : null

  // Worker pool state (see the pool below). Declared early because pushDir wakes idle workers.
  let active = 0
  let wake: (() => void) | null = null
  const notify = (): void => {
    const w = wake
    wake = null
    w?.()
  }
  const pushDir = (parentId: number, name: string, full: string): void => {
    stack.push({ id: tree.add(parentId, name, 'dir'), path: full })
    dirs++
    if (wake) notify()
  }

  /** Adds a regular file, skipping extra hard links to a file already counted. */
  const addFile = async (parentId: number, name: string, full: string, st: Stats): Promise<void> => {
    if (st.nlink > 1) {
      // Only hard-linked files need the exact 64-bit file id (a JS number would lose precision),
      // so the slower BigInt stat runs for them alone.
      try {
        const ino = (await lstat(full, { bigint: true })).ino
        if (seenInodes.has(ino)) {
          hardlinksSkipped++
          return
        }
        seenInodes.add(ino)
      } catch {
        return
      }
    }
    const size = st.size
    const alloc = st.blocks * 512
    const id = tree.add(parentId, name, 'file')
    tree.setFileSize(id, size, alloc, categoryOf(name))
    files++
    logical += size
    allocated += alloc
    bytes += alloc || size
  }

  const processEntry = async (parentId: number, dirPath: string, e: Dirent): Promise<void> => {
    const full = join(dirPath, e.name)
    if (e.isDirectory()) {
      pushDir(parentId, e.name, full)
      return
    }
    try {
      // Reparse points (OneDrive placeholders, junctions, symlinks) all show up as links here;
      // lstat tells real links apart from cloud files and folders, which we do want.
      const st = await lstat(full)
      if (st.isSymbolicLink()) {
        linksSkipped++
      } else if (st.isDirectory()) {
        pushDir(parentId, e.name, full)
      } else if (st.isFile()) {
        await addFile(parentId, e.name, full, st)
      }
    } catch {
      // File vanished or is locked: skip it, the scan goes on.
    }
  }

  const processDir = async (job: { id: number; path: string }): Promise<void> => {
    currentPath = job.path
    let entries: Dirent[]
    try {
      entries = await readdir(job.path, { withFileTypes: true })
    } catch {
      inaccessible++
      if (inaccessibleSample.length < INACCESSIBLE_SAMPLE) inaccessibleSample.push(job.path)
      return
    }
    for (let i = 0; i < entries.length; i += statConcurrency) {
      if (signal?.aborted) return
      const batch = entries.slice(i, i + statConcurrency)
      await Promise.all(batch.map((e) => processEntry(job.id, job.path, e)))
    }
  }

  // Worker pool over the shared stack. A worker that finds the stack empty waits
  // until another worker pushes more folders or everyone is idle (then we are done).

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return
      const job = stack.pop()
      if (!job) {
        if (active === 0) {
          notify()
          return
        }
        await new Promise<void>((r) => {
          const prev = wake
          wake = () => {
            prev?.()
            r()
          }
        })
        continue
      }
      active++
      await processDir(job)
      active--
      notify()
    }
  }

  try {
    await Promise.all(Array.from({ length: dirWorkers }, () => worker()))
  } finally {
    if (timer) clearInterval(timer)
  }

  const allocSupported = allocated > 0 || logical === 0
  tree.finalize(!allocSupported)

  const summary: ScanSummary = {
    root,
    rootId,
    files,
    dirs,
    size: logical,
    alloc: allocSupported ? allocated : logical,
    allocSupported,
    hardlinksSkipped,
    linksSkipped,
    inaccessible,
    inaccessibleSample,
    durationMs: Math.round(performance.now() - started),
    finishedAt: Date.now(),
    categories: tree.categoriesOf(rootId),
    nodes: tree.length,
    cancelled: !!signal?.aborted
  }
  opts.onProgress?.(snapshot())
  return { tree, summary }
}

export const PATH_SEP = sep
