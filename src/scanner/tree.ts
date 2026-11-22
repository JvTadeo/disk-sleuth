import { CATEGORY_COUNT } from '../shared/categories'
import type { ChildrenResult, NodeInfo, NodeKind, RemoveResult, ScanNode, TreemapNode } from '../shared/scan'

const NONE = -1
const KIND_FILE = 0
const KIND_DIR = 1

/**
 * Compact, append-only file tree.
 *
 * One object per file would cost hundreds of bytes and put millions of objects on the GC.
 * Instead every node is an index into parallel typed arrays (~34 bytes per node plus its name).
 * Children are kept as singly linked lists (firstChild / nextSibling), so adding is O(1).
 *
 * Invariant: a child is always created after its parent, so parent[i] < i.
 * That lets `finalize()` aggregate sizes bottom-up in a single reverse pass.
 */
export class ScanTree {
  private cap: number
  private count = 0

  private parent: Int32Array
  private firstChild: Int32Array
  private nextSibling: Int32Array
  private kind: Uint8Array
  private size: Float64Array
  private alloc: Float64Array
  private files: Float64Array
  /** File category index (see shared/categories); 0 for folders. */
  private category: Uint8Array
  private names: string[] = []
  /** Nodes removed by the user (moved to the Recycle Bin). Their subtrees are unreachable. */
  private removed = new Set<number>()

  /**
   * Bytes per category for every folder: a row of CATEGORY_COUNT floats per directory.
   * Float32 is plenty for display (24-bit mantissa) and keeps this at ~40 bytes per folder.
   */
  private dirRow = new Int32Array(0)
  private dirCats = new Float32Array(0)

  constructor(initialCapacity = 1 << 16) {
    this.cap = initialCapacity
    this.parent = new Int32Array(this.cap)
    this.firstChild = new Int32Array(this.cap)
    this.nextSibling = new Int32Array(this.cap)
    this.kind = new Uint8Array(this.cap)
    this.size = new Float64Array(this.cap)
    this.alloc = new Float64Array(this.cap)
    this.files = new Float64Array(this.cap)
    this.category = new Uint8Array(this.cap)
  }

  get length(): number {
    return this.count
  }

  /** Bytes held by the typed arrays (names not included). */
  get arrayBytes(): number {
    return this.cap * (4 * 3 + 1 + 8 * 3 + 1) + this.dirRow.byteLength + this.dirCats.byteLength
  }

  private grow(): void {
    const next = this.cap * 2
    const growI32 = (a: Int32Array): Int32Array => {
      const b = new Int32Array(next)
      b.set(a)
      return b
    }
    const growF64 = (a: Float64Array): Float64Array => {
      const b = new Float64Array(next)
      b.set(a)
      return b
    }
    this.parent = growI32(this.parent)
    this.firstChild = growI32(this.firstChild)
    this.nextSibling = growI32(this.nextSibling)
    const k = new Uint8Array(next)
    k.set(this.kind)
    this.kind = k
    this.size = growF64(this.size)
    this.alloc = growF64(this.alloc)
    this.files = growF64(this.files)
    const c = new Uint8Array(next)
    c.set(this.category)
    this.category = c
    this.cap = next
  }

  /** Adds a node and returns its id. Pass parentId = -1 for the root. */
  add(parentId: number, name: string, kind: NodeKind): number {
    if (this.count === this.cap) this.grow()
    const id = this.count++
    this.parent[id] = parentId
    this.firstChild[id] = NONE
    this.kind[id] = kind === 'dir' ? KIND_DIR : KIND_FILE
    this.names[id] = name
    if (parentId !== NONE) {
      this.nextSibling[id] = this.firstChild[parentId]
      this.firstChild[parentId] = id
    } else {
      this.nextSibling[id] = NONE
    }
    return id
  }

  /** Sets the own size and category of a file node. */
  setFileSize(id: number, size: number, alloc: number, category = 0): void {
    this.size[id] = size
    this.alloc[id] = alloc
    this.files[id] = 1
    this.category[id] = category
  }

  /** Rolls sizes and file counts up into every folder. Call once, after the scan. */
  finalize(copyAllocFromSize: boolean): void {
    if (copyAllocFromSize) this.alloc.set(this.size.subarray(0, this.count))
    for (let i = this.count - 1; i > 0; i--) {
      const p = this.parent[i]
      if (p === NONE) continue
      this.size[p] += this.size[i]
      this.alloc[p] += this.alloc[i]
      this.files[p] += this.files[i]
    }
    this.buildCategoryTotals()
  }

  /** Per-folder bytes by category, bottom-up in one reverse pass (removed subtrees excluded). */
  private buildCategoryTotals(): void {
    const n = this.count
    const C = CATEGORY_COUNT
    const rows = new Int32Array(n).fill(NONE)
    let r = 0
    for (let i = 0; i < n; i++) if (this.kind[i] === KIND_DIR) rows[i] = r++
    const cats = new Float32Array(r * C)
    const skip = new Uint8Array(n)
    for (const id of this.removed) skip[id] = 1
    for (let i = n - 1; i > 0; i--) {
      if (skip[i]) continue
      const p = this.parent[i]
      if (p === NONE) continue
      const pr = rows[p] * C
      if (this.kind[i] === KIND_FILE) {
        cats[pr + this.category[i]] += this.alloc[i]
      } else {
        const cr = rows[i] * C
        for (let k = 0; k < C; k++) cats[pr + k] += cats[cr + k]
      }
    }
    this.dirRow = rows
    this.dirCats = cats
  }

  /** Bytes per category under a node (one entry per category index). */
  categoriesOf(id: number): number[] {
    const out = new Array<number>(CATEGORY_COUNT).fill(0)
    if (id < 0 || id >= this.count) return out
    if (this.kind[id] === KIND_FILE) {
      out[this.category[id]] = this.alloc[id]
      return out
    }
    const row = this.dirRow[id]
    if (row === undefined || row === NONE) return out
    for (let k = 0; k < CATEGORY_COUNT; k++) out[k] = this.dirCats[row * CATEGORY_COUNT + k]
    return out
  }

  /** The category holding the most bytes under a node. */
  dominantCategory(id: number): number {
    if (this.kind[id] === KIND_FILE) return this.category[id]
    const row = this.dirRow[id]
    if (row === undefined || row === NONE) return 0
    let best = 0
    let max = -1
    for (let k = 0; k < CATEGORY_COUNT; k++) {
      const v = this.dirCats[row * CATEGORY_COUNT + k]
      if (v > max) {
        max = v
        best = k
      }
    }
    return best
  }

  // ---------- read access for the snapshot, diff and duplicate modules ----------

  isDir(id: number): boolean {
    return this.kind[id] === KIND_DIR
  }
  parentOf(id: number): number {
    return this.parent[id]
  }
  allocOf(id: number): number {
    return this.alloc[id]
  }
  sizeOf(id: number): number {
    return this.size[id]
  }
  nameOf(id: number): string {
    return this.names[id]
  }
  isAlive(id: number): boolean {
    return this.alive(id)
  }
  /** Children in storage order (unsorted). */
  forEachChild(id: number, fn: (child: number) => void): void {
    for (let c = this.firstChild[id]; c !== NONE; c = this.nextSibling[c]) fn(c)
  }

  node(id: number): ScanNode {
    return {
      id,
      name: this.names[id],
      kind: this.kind[id] === KIND_DIR ? 'dir' : 'file',
      size: this.size[id],
      alloc: this.alloc[id],
      files: this.files[id]
    }
  }

  path(id: number, sep: string): string {
    const parts: string[] = []
    for (let i = id; i !== NONE; i = this.parent[i]) parts.push(this.names[i])
    parts.reverse()
    if (parts.length === 1) return parts[0]
    const root = parts[0].endsWith(sep) ? parts[0] : parts[0] + sep
    return root + parts.slice(1).join(sep)
  }

  trail(id: number): { id: number; name: string }[] {
    const out: { id: number; name: string }[] = []
    for (let i = id; i !== NONE; i = this.parent[i]) out.push({ id: i, name: this.names[i] })
    return out.reverse()
  }

  /**
   * Children of a node, largest first. Past `limit`, the rest is grouped into one entry
   * so the window never receives more than it can show.
   */
  children(id: number, limit: number, sep: string): ChildrenResult | null {
    if (!this.alive(id)) return null
    const ids = this.childIds(id)
    const alloc = this.alloc

    const children = ids.slice(0, limit).map((c) => this.node(c))
    if (ids.length > limit) {
      let size = 0
      let al = 0
      let files = 0
      for (let i = limit; i < ids.length; i++) {
        size += this.size[ids[i]]
        al += alloc[ids[i]]
        files += this.files[ids[i]]
      }
      children.push({
        id: -1,
        name: '',
        kind: 'dir',
        size,
        alloc: al,
        files,
        grouped: true,
        groupedCount: ids.length - limit
      })
    }
    return { parentId: id, path: this.path(id, sep), trail: this.trail(id), parent: this.node(id), children }
  }

  /** False when the node or one of its ancestors was removed. */
  private alive(id: number): boolean {
    if (id < 0 || id >= this.count) return false
    if (!this.removed.size) return true
    for (let i = id; i !== NONE; i = this.parent[i]) if (this.removed.has(i)) return false
    return true
  }

  private childIds(id: number): number[] {
    const ids: number[] = []
    for (let c = this.firstChild[id]; c !== NONE; c = this.nextSibling[c]) ids.push(c)
    const alloc = this.alloc
    return ids.sort((a, b) => alloc[b] - alloc[a])
  }

  info(id: number, sep: string): NodeInfo | null {
    if (!this.alive(id)) return null
    const info: NodeInfo = { node: this.node(id), path: this.path(id, sep), trail: this.trail(id) }
    if (this.kind[id] === KIND_DIR) info.categories = this.categoriesOf(id)
    return info
  }

  /**
   * Nested view for the treemap: `depth` levels below `id`, largest first.
   * Entries too small to see (under 0.01% of the area, a few pixels) are folded into one grouped child per
   * folder, and the whole result is capped at `maxNodes`, so drawing cost stays flat
   * no matter how many files the folder holds.
   */
  treemap(id: number, depth: number, maxNodes: number): TreemapNode | null {
    if (!this.alive(id)) return null
    const minAlloc = this.alloc[id] * 0.0001
    let budget = maxNodes
    const build = (n: number, d: number): TreemapNode => {
      const out: TreemapNode = {
        id: n,
        name: this.names[n],
        kind: this.kind[n] === KIND_DIR ? 'dir' : 'file',
        alloc: this.alloc[n],
        files: this.files[n],
        category: this.dominantCategory(n)
      }
      if (d === 0 || this.kind[n] !== KIND_DIR || budget <= 0) return out
      const ids = this.childIds(n)
      const kids: TreemapNode[] = []
      let i = 0
      for (; i < ids.length && budget > 0 && this.alloc[ids[i]] >= minAlloc; i++) {
        budget--
        kids.push(build(ids[i], d - 1))
      }
      if (i < ids.length) {
        let alloc = 0
        let files = 0
        for (let j = i; j < ids.length; j++) {
          alloc += this.alloc[ids[j]]
          files += this.files[ids[j]]
        }
        if (alloc > 0) {
          kids.push({ id: -1, name: '', kind: 'dir', alloc, files, grouped: true, groupedCount: ids.length - i })
        }
      }
      if (kids.length) out.children = kids
      return out
    }
    return build(id, depth)
  }

  /** The `limit` largest files in the whole tree (by size on disk). One pass, no sorting of the full set. */
  largestFiles(limit: number, sep: string): NodeInfo[] {
    const top: number[] = [] // ascending by alloc
    const alloc = this.alloc
    for (let i = 0; i < this.count; i++) {
      if (this.kind[i] !== KIND_FILE) continue
      const a = alloc[i]
      if (top.length === limit && a <= alloc[top[0]]) continue
      let lo = 0
      let hi = top.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (alloc[top[mid]] < a) lo = mid + 1
        else hi = mid
      }
      top.splice(lo, 0, i)
      if (top.length > limit) top.shift()
    }
    return top
      .reverse()
      .filter((i) => this.alive(i))
      .map((i) => ({ node: this.node(i), path: this.path(i, sep), trail: this.trail(i) }))
  }

  /** Detaches a node (after it went to the Recycle Bin) and subtracts its totals from every ancestor. */
  remove(id: number): RemoveResult | null {
    if (!this.alive(id) || this.parent[id] === NONE) return null
    const p = this.parent[id]
    if (this.firstChild[p] === id) {
      this.firstChild[p] = this.nextSibling[id]
    } else {
      for (let c = this.firstChild[p]; c !== NONE; c = this.nextSibling[c]) {
        if (this.nextSibling[c] === id) {
          this.nextSibling[c] = this.nextSibling[id]
          break
        }
      }
    }
    const size = this.size[id]
    const al = this.alloc[id]
    const files = this.files[id]
    const cats = this.categoriesOf(id)
    const C = CATEGORY_COUNT
    let root = p
    for (let a = p; a !== NONE; a = this.parent[a]) {
      this.size[a] -= size
      this.alloc[a] -= al
      this.files[a] -= files
      const row = this.dirRow[a]
      if (row !== undefined && row !== NONE) for (let k = 0; k < C; k++) this.dirCats[row * C + k] -= cats[k]
      root = a
    }
    this.removed.add(id)
    return { root: this.node(root) }
  }

  /** Finds a node by absolute path (case-insensitive, as on Windows). Returns -1 when not in the tree. */
  findPath(path: string): number {
    if (!this.count) return -1
    const root = this.names[0].replace(/[\\/]+$/, '').toLowerCase()
    const target = path.replace(/[\\/]+$/, '').toLowerCase()
    if (target !== root && !target.startsWith(root + '\\') && !target.startsWith(root + '/')) return -1
    const parts = target.slice(root.length).split(/[\\/]+/).filter(Boolean)
    let id = 0
    for (const part of parts) {
      let next = NONE
      for (let c = this.firstChild[id]; c !== NONE; c = this.nextSibling[c]) {
        if (this.names[c].toLowerCase() === part) {
          next = c
          break
        }
      }
      if (next === NONE) return -1
      id = next
    }
    return this.alive(id) ? id : -1
  }

  /** Sizes on disk for many paths at once; null for paths outside the scan. */
  sizesOf(paths: string[]): (number | null)[] {
    return paths.map((p) => {
      const id = this.findPath(p)
      return id < 0 ? null : this.alloc[id]
    })
  }

  // ---------- persistence ----------

  /**
   * Binary snapshot: [u32 header length][JSON header][typed arrays, raw][removed ids][names joined by NUL].
   * Raw arrays make saving and loading a straight memory copy (no per-node parsing).
   */
  serialize(): Buffer[] {
    const n = this.count
    const names = Buffer.from(this.names.slice(0, n).join('\0'), 'utf8')
    const removed = Int32Array.from(this.removed)
    const header = Buffer.from(JSON.stringify({ v: ScanTree.FORMAT, n, names: names.length, removed: removed.length }))
    const len = Buffer.alloc(4)
    len.writeUInt32LE(header.length)
    const raw = (a: Int32Array | Uint8Array | Float64Array): Buffer =>
      Buffer.from(a.buffer, a.byteOffset, n * a.BYTES_PER_ELEMENT)
    return [
      len,
      header,
      raw(this.parent),
      raw(this.firstChild),
      raw(this.nextSibling),
      raw(this.kind),
      raw(this.size),
      raw(this.alloc),
      raw(this.files),
      raw(this.category),
      Buffer.from(removed.buffer, removed.byteOffset, removed.byteLength),
      names
    ]
  }

  /** 2: adds the per-file category array. */
  static readonly FORMAT = 2

  static deserialize(buf: Buffer): ScanTree {
    const headerLen = buf.readUInt32LE(0)
    const header = JSON.parse(buf.subarray(4, 4 + headerLen).toString('utf8')) as {
      v: number
      n: number
      names: number
      removed: number
    }
    if (header.v !== ScanTree.FORMAT) throw new Error(`Unsupported cache format ${header.v}`)
    const n = header.n
    const tree = new ScanTree(Math.max(n, 1 << 16))
    let off = 4 + headerLen
    // Copy byte-wise: the file buffer is not guaranteed to be aligned for Float64Array views.
    const fill = (a: Int32Array | Uint8Array | Float64Array, count: number): void => {
      const bytes = count * a.BYTES_PER_ELEMENT
      new Uint8Array(a.buffer, a.byteOffset, bytes).set(buf.subarray(off, off + bytes))
      off += bytes
    }
    fill(tree.parent, n)
    fill(tree.firstChild, n)
    fill(tree.nextSibling, n)
    fill(tree.kind, n)
    fill(tree.size, n)
    fill(tree.alloc, n)
    fill(tree.files, n)
    fill(tree.category, n)
    const removed = new Int32Array(header.removed)
    fill(removed, header.removed)
    tree.removed = new Set(removed)
    tree.names = buf.subarray(off, off + header.names).toString('utf8').split('\0')
    tree.count = n
    tree.buildCategoryTotals()
    return tree
  }
}
