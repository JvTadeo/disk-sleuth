import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import type { DuplicateGroup, DuplicateProgress, DuplicateResult } from '../shared/scan'
import type { ScanTree } from './tree'

const PARTIAL_BYTES = 64 * 1024
const CONCURRENCY = 4
const MAX_GROUPS = 300

export interface DuplicateOptions {
  minSize: number
  sep: string
  signal: AbortSignal
  onProgress: (p: DuplicateProgress) => void
}

/** Runs `fn` over items with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, signal: AbortSignal, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length && !signal.aborted) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function partialHash(path: string, size: number): Promise<string | null> {
  try {
    const fh = await open(path, 'r')
    try {
      const h = createHash('md5')
      // Files up to 128 KB are read whole here, so this hash is already their full-content hash.
      const head = Buffer.alloc(size <= PARTIAL_BYTES * 2 ? size : PARTIAL_BYTES)
      await fh.read(head, 0, head.length, 0)
      h.update(head)
      if (size > PARTIAL_BYTES * 2) {
        const tail = Buffer.alloc(PARTIAL_BYTES)
        await fh.read(tail, 0, PARTIAL_BYTES, size - PARTIAL_BYTES)
        h.update(tail)
      }
      return h.digest('hex')
    } finally {
      await fh.close()
    }
  } catch {
    return null // locked or vanished: not a candidate
  }
}

function fullHash(path: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<string | null> {
  return new Promise((resolve) => {
    const h = createHash('md5')
    const s = createReadStream(path, { highWaterMark: 1024 * 1024 })
    const abort = (): void => {
      s.destroy()
      resolve(null)
    }
    signal.addEventListener('abort', abort, { once: true })
    s.on('data', (chunk) => {
      h.update(chunk)
      onBytes(chunk.length)
    })
    s.on('error', () => {
      signal.removeEventListener('abort', abort)
      resolve(null)
    })
    s.on('end', () => {
      signal.removeEventListener('abort', abort)
      resolve(h.digest('hex'))
    })
  })
}

function regroup(groups: number[][], keyOf: Map<number, string | null>): number[][] {
  const out: number[][] = []
  for (const g of groups) {
    const by = new Map<string, number[]>()
    for (const id of g) {
      const k = keyOf.get(id)
      if (!k) continue
      const list = by.get(k)
      if (list) list.push(id)
      else by.set(k, [id])
    }
    for (const list of by.values()) if (list.length > 1) out.push(list)
  }
  return out
}

/**
 * Finds files with identical content, cheapest test first:
 * 1. same size (from the tree, no disk access);
 * 2. same hash of the first and last 64 KB;
 * 3. same hash of the whole file.
 * Hard links are already counted once by the scanner, so they never show up as copies.
 */
export async function findDuplicates(tree: ScanTree, opts: DuplicateOptions): Promise<DuplicateResult> {
  const started = performance.now()
  const { signal, onProgress, sep, minSize } = opts

  // 1. Group by exact size.
  const bySize = new Map<number, number[]>()
  for (let i = 0; i < tree.length; i++) {
    if (tree.isDir(i)) continue
    const size = tree.sizeOf(i)
    if (size < minSize || !tree.isAlive(i)) continue
    const list = bySize.get(size)
    if (list) list.push(i)
    else bySize.set(size, [i])
  }
  let groups = [...bySize.values()].filter((g) => g.length > 1)
  const candidates = groups.flat()

  const progress: DuplicateProgress = {
    phase: 'partial',
    filesDone: 0,
    filesTotal: candidates.length,
    bytesDone: 0,
    bytesTotal: 0,
    elapsedMs: 0
  }
  const tick = setInterval(() => {
    progress.elapsedMs = Math.round(performance.now() - started)
    onProgress({ ...progress })
  }, 150)

  try {
    // 2. Partial hashes.
    const partial = new Map<number, string | null>()
    await pool(candidates, CONCURRENCY * 2, signal, async (id) => {
      partial.set(id, await partialHash(tree.path(id, sep), tree.sizeOf(id)))
      progress.filesDone++
    })
    groups = regroup(groups, partial)

    // 3. Full hashes for what is left. Small files were fully read in step 2 already.
    const needFull = groups.filter((g) => tree.sizeOf(g[0]) > PARTIAL_BYTES * 2).flat()
    progress.phase = 'full'
    progress.filesDone = 0
    progress.filesTotal = needFull.length
    progress.bytesTotal = needFull.reduce((a, id) => a + tree.sizeOf(id), 0)
    const full = new Map<number, string | null>()
    for (const g of groups) if (tree.sizeOf(g[0]) <= PARTIAL_BYTES * 2) for (const id of g) full.set(id, partial.get(id) ?? null)
    // Biggest files first: the most space to win, and results are useful even if cancelled.
    needFull.sort((a, b) => tree.sizeOf(b) - tree.sizeOf(a))
    await pool(needFull, CONCURRENCY, signal, async (id) => {
      full.set(id, await fullHash(tree.path(id, sep), signal, (n) => (progress.bytesDone += n)))
      progress.filesDone++
    })
    groups = regroup(groups, full)
  } finally {
    clearInterval(tick)
  }

  const result: DuplicateGroup[] = groups
    .map((g) => ({
      size: tree.sizeOf(g[0]),
      wasted: tree.allocOf(g[0]) * (g.length - 1),
      files: g.map((id) => ({ id, name: tree.nameOf(id), path: tree.path(id, sep) }))
    }))
    .sort((a, b) => b.wasted - a.wasted)

  return {
    groups: result.slice(0, MAX_GROUPS),
    totalGroups: result.length,
    wasted: result.reduce((a, g) => a + g.wasted, 0),
    candidates: candidates.length,
    hashedBytes: progress.bytesDone,
    durationMs: Math.round(performance.now() - started),
    minSize,
    cancelled: signal.aborted,
    finishedAt: Date.now()
  }
}
