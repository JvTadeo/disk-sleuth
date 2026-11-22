/**
 * Scanner process entry point (Electron utilityProcess).
 *
 * The scan and the resulting tree live here, outside the window and the main process,
 * so a multi-million-file scan never blocks the UI. The window asks for one folder level
 * at a time ("children of X") instead of receiving the whole tree.
 */

process.env.UV_THREADPOOL_SIZE ??= '32'

import { open, readFile, rename } from 'node:fs/promises'
import type { ScannerMessage, ScannerQuery, ScannerRequest } from '../shared/scan'
import { scan, PATH_SEP } from './scan'
import { ScanTree } from './tree'
import { buildSnapshot, diffTrees, Snapshot } from './snapshot'
import { findDuplicates } from './duplicates'
import { findDevProjects } from './devjunk'

const port = process.parentPort
if (!port) throw new Error('scanner must run inside an Electron utilityProcess')

let tree: ScanTree | null = null
let running: AbortController | null = null
/** Pending restore from disk; queries wait for it. */
let loading: Promise<void> | null = null

/** Writes buffers to a temp file and renames it: a crash mid-write never leaves a half-written file. */
async function writeAtomic(file: string, parts: Buffer[]): Promise<void> {
  const tmp = `${file}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writev(parts)
  } finally {
    await handle.close()
  }
  await rename(tmp, file)
}

async function saveTree(file: string, snapFile: string): Promise<boolean> {
  if (!tree) return false
  await writeAtomic(file, tree.serialize())
  await writeAtomic(snapFile, buildSnapshot(tree, Date.now()))
  return true
}

async function diffWith(snapFile: string, previousTotal?: number) {
  if (!tree) return null
  let buf: Buffer
  try {
    buf = await readFile(snapFile)
  } catch {
    return null // no previous scan of this root
  }
  const snap = new Snapshot(buf)
  return diffTrees(tree, snap, PATH_SEP, previousTotal ?? snap.rootAlloc)
}

let dupRun: AbortController | null = null

async function startDuplicates(minSize: number): Promise<void> {
  dupRun?.abort()
  if (loading) await loading.catch(() => {})
  if (!tree) {
    post({ type: 'dupError', message: 'No scan loaded.' })
    return
  }
  const ac = new AbortController()
  dupRun = ac
  try {
    const result = await findDuplicates(tree, {
      minSize,
      sep: PATH_SEP,
      signal: ac.signal,
      onProgress: (progress) => post({ type: 'dupProgress', progress })
    })
    if (dupRun === ac) post({ type: 'dupDone', result })
  } catch (err) {
    post({ type: 'dupError', message: err instanceof Error ? err.message : String(err) })
  } finally {
    if (dupRun === ac) dupRun = null
  }
}

function loadTree(file: string): Promise<boolean> {
  const job = readFile(file).then((buf) => {
    tree = ScanTree.deserialize(buf)
  })
  loading = job.finally(() => {
    loading = null
  })
  return job.then(() => true)
}

const post = (msg: ScannerMessage): void => port.postMessage(msg)

async function startScan(root: string): Promise<void> {
  running?.abort()
  dupRun?.abort()
  const ac = new AbortController()
  running = ac
  tree = null // release the previous tree before building a new one
  try {
    const result = await scan(root, {
      signal: ac.signal,
      progressIntervalMs: 100,
      onProgress: (progress) => post({ type: 'progress', progress })
    })
    if (running !== ac) return // superseded by a newer scan
    tree = result.tree
    post({ type: 'done', summary: result.summary })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    if (running === ac) running = null
  }
}

/** Size of a folder that is not part of the tree (a tool cache on another drive, say). */
async function folderSize(path: string): Promise<{ alloc: number; files: number } | null> {
  try {
    const { summary } = await scan(path, { dirWorkers: 8, statConcurrency: 8 })
    return { alloc: summary.alloc, files: summary.files }
  } catch {
    return null
  }
}

async function runQuery(q: ScannerQuery): Promise<unknown> {
  if (q.kind === 'load') return loadTree(q.params.file)
  if (loading) await loading.catch(() => {})
  if (q.kind === 'save') return saveTree(q.params.file, q.params.snapFile)
  if (q.kind === 'diff') return diffWith(q.params.snapFile, q.params.previousTotal)
  if (q.kind === 'folderSize') return folderSize(q.params.path)
  if (!tree) return null
  switch (q.kind) {
    case 'children':
      return tree.children(q.params.nodeId, q.params.limit, PATH_SEP)
    case 'treemap':
      return tree.treemap(q.params.nodeId, q.params.depth, q.params.maxNodes)
    case 'info':
      return tree.info(q.params.nodeId, PATH_SEP)
    case 'largestFiles':
      return tree.largestFiles(q.params.limit, PATH_SEP)
    case 'remove':
      return tree.remove(q.params.nodeId)
    case 'findPath':
      return tree.findPath(q.params.path)
    case 'sizes':
      return tree.sizesOf(q.params.paths)
    case 'devProjects':
      return findDevProjects(tree, PATH_SEP)
    case 'removeChildren': {
      const ids: number[] = []
      tree.forEachChild(q.params.nodeId, (c) => ids.push(c))
      let result = null
      for (const c of ids) result = tree.remove(c) ?? result
      return result
    }
  }
}

port.on('message', (e: { data: ScannerRequest }) => {
  const req = e.data
  switch (req.type) {
    case 'scan':
      void startScan(req.root)
      break
    case 'cancel':
      running?.abort()
      break
    case 'duplicates':
      void startDuplicates(req.minSize)
      break
    case 'cancelDuplicates':
      dupRun?.abort()
      break
    case 'query':
      runQuery(req.query).then(
        (result) => post({ type: 'reply', reqId: req.reqId, result }),
        (err: unknown) =>
          post({ type: 'reply', reqId: req.reqId, result: null, error: err instanceof Error ? err.message : String(err) })
      )
      break
  }
})
