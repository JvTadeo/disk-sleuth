import { statfs } from 'node:fs/promises'
import type { DriveInfo } from '@shared/ipc'

/** Network drives or empty card readers can hang: every probe has a timeout. */
const TIMEOUT_MS = 1500

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

async function probe(root: string, letter: string): Promise<DriveInfo | null> {
  try {
    const s = await withTimeout(statfs(root), TIMEOUT_MS)
    const total = s.blocks * s.bsize
    if (!total) return null
    return { letter, root, total, free: s.bavail * s.bsize }
  } catch {
    return null
  }
}

/** Lists mounted drives. On Windows, probes C: through Z: in parallel. */
export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') {
    const d = await probe('/', '/')
    return d ? [d] : []
  }
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const found = await Promise.all(letters.map((l) => probe(`${l}:\\`, l)))
  return found.filter((d): d is DriveInfo => d !== null)
}
