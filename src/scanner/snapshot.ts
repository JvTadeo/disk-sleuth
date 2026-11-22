import type { ScanChange, ScanDiff } from '../shared/scan'
import type { ScanTree } from './tree'

/**
 * A light copy of a scan kept next to the full cache, for "what changed since last time".
 * It holds every folder plus files of at least SNAPSHOT_MIN_FILE, which is enough to explain
 * real growth while staying small (a few MB for a full drive).
 */

const FORMAT = 1
export const SNAPSHOT_MIN_FILE = 10 * 1024 * 1024
/** Changes smaller than this are noise for a "what changed" summary. */
export const DIFF_MIN_CHANGE = 100 * 1024 * 1024
const MAX_CHANGES = 40
const NONE = -1

export function buildSnapshot(tree: ScanTree, takenAt: number): Buffer[] {
  const n = tree.length
  const map = new Int32Array(n).fill(NONE)
  const parent: number[] = []
  const alloc: number[] = []
  const kind: number[] = []
  const names: string[] = []
  // Parents come before children in the tree, so one forward pass keeps parent indexes valid.
  for (let i = 0; i < n; i++) {
    if (!tree.isAlive(i)) continue
    const dir = tree.isDir(i)
    if (!dir && tree.allocOf(i) < SNAPSHOT_MIN_FILE) continue
    const p = tree.parentOf(i)
    if (p !== NONE && map[p] === NONE) continue
    map[i] = parent.length
    parent.push(p === NONE ? NONE : map[p])
    alloc.push(tree.allocOf(i))
    kind.push(dir ? 1 : 0)
    names.push(tree.nameOf(i))
  }
  const nameBuf = Buffer.from(names.join('\0'), 'utf8')
  const header = Buffer.from(JSON.stringify({ v: FORMAT, n: parent.length, names: nameBuf.length, takenAt }))
  const len = Buffer.alloc(4)
  len.writeUInt32LE(header.length)
  const p32 = Int32Array.from(parent)
  const a64 = Float64Array.from(alloc)
  const k8 = Uint8Array.from(kind)
  return [len, header, Buffer.from(p32.buffer), Buffer.from(a64.buffer), Buffer.from(k8.buffer), nameBuf]
}

export class Snapshot {
  readonly takenAt: number
  private parent: Int32Array
  private alloc: Float64Array
  private kind: Uint8Array
  private names: string[]
  private firstChild: Int32Array
  private nextSibling: Int32Array

  constructor(buf: Buffer) {
    const hl = buf.readUInt32LE(0)
    const h = JSON.parse(buf.subarray(4, 4 + hl).toString('utf8')) as { v: number; n: number; names: number; takenAt: number }
    if (h.v !== FORMAT) throw new Error(`Unsupported snapshot format ${h.v}`)
    const n = h.n
    let off = 4 + hl
    const copy = <T extends Int32Array | Float64Array | Uint8Array>(a: T): T => {
      new Uint8Array(a.buffer).set(buf.subarray(off, off + a.byteLength))
      off += a.byteLength
      return a
    }
    this.parent = copy(new Int32Array(n))
    this.alloc = copy(new Float64Array(n))
    this.kind = copy(new Uint8Array(n))
    this.names = buf.subarray(off, off + h.names).toString('utf8').split('\0')
    this.takenAt = h.takenAt
    this.firstChild = new Int32Array(n).fill(NONE)
    this.nextSibling = new Int32Array(n).fill(NONE)
    for (let i = n - 1; i > 0; i--) {
      const p = this.parent[i]
      if (p === NONE) continue
      this.nextSibling[i] = this.firstChild[p]
      this.firstChild[p] = i
    }
  }

  get rootAlloc(): number {
    return this.alloc[0] ?? 0
  }

  childrenByName(id: number): Map<string, number> {
    const m = new Map<string, number>()
    for (let c = this.firstChild[id]; c !== NONE; c = this.nextSibling[c]) m.set(this.names[c].toLowerCase(), c)
    return m
  }

  allocOf(id: number): number {
    return this.alloc[id]
  }
  isDir(id: number): boolean {
    return this.kind[id] === 1
  }
  nameOf(id: number): string {
    return this.names[id]
  }
}

/**
 * Compares the current tree with a previous snapshot.
 *
 * It walks both trees together, only into branches that changed by at least DIFF_MIN_CHANGE, and reports
 * the deepest such branches: a folder is listed when none of its children changed enough on their own.
 * So "Downloads +12 GB" is listed instead of "Users +12 GB", "voce +12 GB" and "Downloads +12 GB".
 */
export function diffTrees(tree: ScanTree, snap: Snapshot, sep: string, previousTotal = snap.rootAlloc): ScanDiff {
  const changes: ScanChange[] = []
  const join = (base: string, name: string): string => (base.endsWith(sep) ? base + name : base + sep + name)

  const visit = (cur: number, prev: number, path: string, name: string): void => {
    const before = prev === NONE ? 0 : snap.allocOf(prev)
    const after = cur === NONE ? 0 : tree.allocOf(cur)
    const delta = after - before
    if (Math.abs(delta) < DIFF_MIN_CHANGE) return

    const curDir = cur !== NONE && tree.isDir(cur)
    const prevDir = prev !== NONE && snap.isDir(prev)
    let significantChild = false

    if (curDir || prevDir) {
      const prevKids = prevDir ? snap.childrenByName(prev) : new Map<string, number>()
      const pairs: [number, number, string][] = []
      if (curDir) {
        tree.forEachChild(cur, (c) => {
          if (!tree.isAlive(c)) return
          const key = tree.nameOf(c).toLowerCase()
          const p = prevKids.get(key) ?? NONE
          prevKids.delete(key)
          pairs.push([c, p, tree.nameOf(c)])
        })
      }
      for (const p of prevKids.values()) pairs.push([NONE, p, snap.nameOf(p)])
      for (const [c, p, childName] of pairs) {
        const b = p === NONE ? 0 : snap.allocOf(p)
        const a = c === NONE ? 0 : tree.allocOf(c)
        if (Math.abs(a - b) >= DIFF_MIN_CHANGE) {
          significantChild = true
          visit(c, p, join(path, childName), childName)
        }
      }
    }

    if (!significantChild && (cur !== 0 || prev !== 0)) {
      changes.push({
        path,
        name,
        kind: curDir || (cur === NONE && prevDir) ? 'dir' : 'file',
        before,
        after,
        delta,
        status: before === 0 ? 'new' : after === 0 ? 'removed' : delta > 0 ? 'grew' : 'shrank',
        ...(cur !== NONE ? { id: cur } : {})
      })
    }
  }

  const rootName = tree.nameOf(0)
  visit(0, 0, rootName, rootName)
  changes.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  return {
    previousAt: snap.takenAt,
    previousTotal,
    totalDelta: tree.allocOf(0) - previousTotal,
    changes: changes.slice(0, MAX_CHANGES)
  }
}
