import type { TreemapNode } from '@shared/scan'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Cell extends Rect {
  node: TreemapNode
  /** 1 = direct child of the folder on screen, 2 = grandchild. */
  depth: number
  /** Index of the top-level ancestor, used to pick the color. */
  colorIndex: number
  /** Height reserved at the top for the folder's name (depth-1 cells with children). */
  header: number
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk). Returns one rect per value, in input order.
 * Values must be positive and sorted descending (best aspect ratios).
 */
export function squarify(values: number[], area: Rect): Rect[] {
  const out: Rect[] = new Array(values.length)
  const total = values.reduce((a, b) => a + b, 0)
  if (total <= 0 || area.w <= 0 || area.h <= 0) return values.map(() => ({ x: area.x, y: area.y, w: 0, h: 0 }))

  let { x, y, w, h } = area
  const scale = (w * h) / total
  const areas = values.map((v) => v * scale)

  const worst = (start: number, end: number, side: number): number => {
    let s = 0
    let max = 0
    let min = Infinity
    for (let i = start; i < end; i++) {
      s += areas[i]
      if (areas[i] > max) max = areas[i]
      if (areas[i] < min) min = areas[i]
    }
    const s2 = s * s
    const side2 = side * side
    return Math.max((side2 * max) / s2, s2 / (side2 * min))
  }

  const layoutRow = (start: number, end: number): void => {
    let s = 0
    for (let i = start; i < end; i++) s += areas[i]
    if (w >= h) {
      const cw = s / h
      let cy = y
      for (let i = start; i < end; i++) {
        const rh = areas[i] / cw
        out[i] = { x, y: cy, w: cw, h: rh }
        cy += rh
      }
      x += cw
      w -= cw
    } else {
      const rh = s / w
      let cx = x
      for (let i = start; i < end; i++) {
        const rw = areas[i] / rh
        out[i] = { x: cx, y, w: rw, h: rh }
        cx += rw
      }
      y += rh
      h -= rh
    }
  }

  let start = 0
  let end = 0
  while (end < areas.length) {
    const side = Math.min(w, h)
    if (end === start || worst(start, end + 1, side) <= worst(start, end, side)) {
      end++
    } else {
      layoutRow(start, end)
      start = end
    }
  }
  if (end > start) layoutRow(start, end)
  return out
}

const HEADER = 18
const PAD = 3

/** Lays out a two-level treemap. Cells come parents-first, so drawing in order paints children on top. */
export function layoutTreemap(root: TreemapNode, width: number, height: number): Cell[] {
  const cells: Cell[] = []
  const top = (root.children ?? []).filter((c) => c.alloc > 0)
  const rects = squarify(
    top.map((c) => c.alloc),
    { x: 0, y: 0, w: width, h: height }
  )
  top.forEach((node, i) => {
    const r = rects[i]
    const kids = (node.children ?? []).filter((c) => c.alloc > 0)
    const nested = kids.length > 0 && r.w > 48 && r.h > 40
    const header = nested && r.h > 64 && r.w > 80 ? HEADER : 0
    cells.push({ ...r, node, depth: 1, colorIndex: i, header })
    if (!nested) return
    const inner: Rect = {
      x: r.x + PAD,
      y: r.y + (header || PAD),
      w: r.w - PAD * 2,
      h: r.h - (header || PAD) - PAD
    }
    const kidRects = squarify(
      kids.map((k) => k.alloc),
      inner
    )
    kids.forEach((k, j) => cells.push({ ...kidRects[j], node: k, depth: 2, colorIndex: i, header: 0 }))
  })
  return cells
}

/** Deepest cell under a point (children are later in the list than their parent). */
export function hitTest(cells: Cell[], px: number, py: number): Cell | null {
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i]
    if (px >= c.x && px < c.x + c.w && py >= c.y && py < c.y + c.h) return c
  }
  return null
}
