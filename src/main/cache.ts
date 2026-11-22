import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CacheInfo } from '@shared/ipc'
import type { ScanSummary } from '@shared/scan'

/**
 * Saved scans, one per drive (or folder), so each drive opens with its own results.
 * Per scan: a small JSON sidecar (read synchronously when the drive is selected) and the binary tree
 * (loaded by the scanner process). `active.json` remembers which scan to show at startup.
 */

const VERSION = 2 // 2: tree format with file categories

interface CacheMeta {
  version: number
  summary: ScanSummary
  savedAt: number
}

const dir = (): string => join(app.getPath('userData'), 'scan-cache')

/** "C:\" → "drive-C", "/" → "root", other folders → a short hash of the path. */
function keyFor(root: string): string {
  const drive = root.match(/^([a-z]):[\\/]*$/i)
  if (drive) return `drive-${drive[1].toUpperCase()}`
  if (root === '/') return 'root'
  return `path-${createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 12)}`
}

export const cacheFile = (root: string): string => join(dir(), `${keyFor(root)}.bin`)
/** Light copy of the scan used to compare with the next scan of the same root. */
export const snapshotFile = (root: string): string => join(dir(), `${keyFor(root)}.snap`)
const metaFile = (root: string): string => join(dir(), `${keyFor(root)}.json`)
const activeFile = (): string => join(dir(), 'active.json')

function readMeta(file: string): CacheMeta | null {
  try {
    const meta = JSON.parse(readFileSync(file, 'utf8')) as CacheMeta
    return meta.version === VERSION ? meta : null
  } catch {
    return null
  }
}

/** The saved summary for a root, if its cache is complete and current. */
export function readCacheMeta(root: string): ScanSummary | null {
  if (!existsSync(cacheFile(root))) return null
  const meta = readMeta(metaFile(root))
  return meta ? { ...meta.summary, fromCache: true } : null
}

export async function prepareCacheDir(): Promise<void> {
  await mkdir(dir(), { recursive: true })
  // Phase 5's first version kept a single "last-scan" file; it is superseded by per-drive files.
  await rm(join(dir(), 'last-scan.bin'), { force: true })
  await rm(join(dir(), 'last-scan.json'), { force: true })
}

/** Writes the sidecar after the binary was saved, so a sidecar always points at a complete file. */
export async function writeCacheMeta(summary: ScanSummary): Promise<void> {
  const { fromCache: _ignored, ...clean } = summary
  const meta: CacheMeta = { version: VERSION, summary: clean, savedAt: Date.now() }
  await writeFile(metaFile(summary.root), JSON.stringify(meta), 'utf8')
}

export function getActiveRoot(): string | null {
  try {
    return (JSON.parse(readFileSync(activeFile(), 'utf8')) as { root?: string }).root ?? null
  } catch {
    return null
  }
}

export async function setActiveRoot(root: string): Promise<void> {
  await mkdir(dir(), { recursive: true })
  await writeFile(activeFile(), JSON.stringify({ root }), 'utf8')
}

/** Every saved scan, largest first. */
export async function cacheInfo(): Promise<CacheInfo[]> {
  if (!existsSync(dir())) return []
  const out: CacheInfo[] = []
  for (const name of readdirSync(dir())) {
    if (!name.endsWith('.json') || name === 'active.json') continue
    const meta = readMeta(join(dir(), name))
    if (!meta) continue
    try {
      const st = await stat(cacheFile(meta.summary.root))
      out.push({ root: meta.summary.root, bytes: st.size, savedAt: meta.savedAt })
    } catch {
      // sidecar without its binary: ignore
    }
  }
  return out.sort((a, b) => b.bytes - a.bytes)
}

export async function clearCache(root?: string): Promise<void> {
  if (!root) {
    await rm(dir(), { recursive: true, force: true })
    return
  }
  await rm(cacheFile(root), { force: true })
  await rm(metaFile(root), { force: true })
  await rm(snapshotFile(root), { force: true })
}
