import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TreemapNode } from '@shared/scan'
import { formatBytes, formatInt } from '@/lib/format'
import { hitTest, layoutTreemap, type Cell } from '@/lib/treemap-layout'
import { categoryColors } from '@/lib/categories'
import type { ColorMode } from '@/store/app'

interface Palette {
  bg: string
  text: string
  muted: string
  hover: string
  selected: string
  grouped: string
  /** [cell fill, frame/header fill] per top-level item. */
  colors: [string, string][]
}

// Light tints with dark text / deep tones with light text. Neighbors differ in lightness, not just hue.
const LIGHT: Palette = {
  bg: '#ffffff',
  text: '#09090b',
  muted: '#3f3f46',
  hover: '#09090b',
  selected: '#2563eb',
  grouped: '#e4e4e7',
  colors: [
    ['#bfdbfe', '#93c5fd'],
    ['#fde68a', '#fcd34d'],
    ['#99f6e4', '#5eead4'],
    ['#ddd6fe', '#c4b5fd'],
    ['#fbcfe8', '#f9a8d4'],
    ['#d9f99d', '#bef264'],
    ['#fed7aa', '#fdba74'],
    ['#bae6fd', '#7dd3fc']
  ]
}

const DARK: Palette = {
  bg: '#18181b',
  text: '#fafafa',
  muted: '#d4d4d8',
  hover: '#fafafa',
  selected: '#60a5fa',
  grouped: '#3f3f46',
  colors: [
    ['#1e3a8a', '#172554'],
    ['#78350f', '#451a03'],
    ['#134e4a', '#042f2e'],
    ['#4c1d95', '#2e1065'],
    ['#831843', '#500724'],
    ['#365314', '#1a2e05'],
    ['#7c2d12', '#431407'],
    ['#0c4a6e', '#082f49']
  ]
}

const FONT = '"Geist Variable", "Segoe UI", sans-serif'
const MONO = '"Geist Mono Variable", Consolas, monospace'

interface TreemapProps {
  data: TreemapNode | null
  dark: boolean
  colorMode: ColorMode
  selectedId: number | null
  onSelect: (node: TreemapNode) => void
  onOpen: (node: TreemapNode) => void
  /** Right-click on a cell. */
  onMenu?: (node: TreemapNode) => void
  label: string
}

function fillFor(c: Cell, p: Palette, mode: ColorMode, dark: boolean): string {
  if (c.node.grouped) return p.grouped
  const [cell, frame] = mode === 'type' ? categoryColors(c.node.category, dark) : p.colors[c.colorIndex % p.colors.length]
  return c.depth === 1 && (c.node.children?.length ?? 0) > 0 && c.header + 6 < c.h ? frame : cell
}

/** Cuts text to fit a width, with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? text.slice(0, lo) + '…' : ''
}

function safePerfFlag(): boolean {
  try {
    return localStorage.getItem('perf') === '1'
  } catch {
    return false
  }
}

function groupedName(n: TreemapNode): string {
  return `${formatInt(n.groupedCount ?? 0)} itens menores`
}

/**
 * Treemap drawn on canvas: thousands of cells cost one draw call each and no DOM nodes.
 * The base layer is drawn only when data, size or theme change; hover and selection go on a
 * second canvas on top, so moving the mouse never repaints the map.
 */
export function Treemap({ data, dark, colorMode, selectedId, onSelect, onOpen, onMenu, label }: TreemapProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const base = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [tip, setTip] = useState<{ x: number; y: number; cell: Cell } | null>(null)
  const hover = useRef<Cell | null>(null)
  const raf = useRef(0)

  const palette = dark ? DARK : LIGHT

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cells = useMemo(
    () => (data && size.w > 0 && size.h > 0 ? layoutTreemap(data, size.w, size.h) : []),
    [data, size]
  )

  // A new layout invalidates the hovered cell (its coordinates belong to the old one).
  useEffect(() => {
    hover.current = null
    setTip(null)
  }, [cells])

  const prepare = (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
    if (!canvas) return null
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(size.w * dpr)
    const ph = Math.round(size.h * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }

  // Base layer.
  useEffect(() => {
    const ctx = prepare(base.current)
    if (!ctx) return
    const t0 = performance.now()
    ctx.fillStyle = palette.bg
    ctx.fillRect(0, 0, size.w, size.h)
    ctx.textBaseline = 'alphabetic'

    for (const c of cells) {
      if (c.w < 1 || c.h < 1) continue
      ctx.fillStyle = fillFor(c, palette, colorMode, dark)
      // 1px gutter so neighbors stay apart; rounded corners on cells big enough to show them.
      const x = c.x + 1
      const y = c.y + 1
      const w = c.w - 2
      const h = c.h - 2
      if (w <= 0 || h <= 0) continue
      if (w > 12 && h > 12) {
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, c.depth === 1 ? 6 : 4)
        ctx.fill()
      } else {
        ctx.fillRect(x, y, w, h)
      }
    }

    // Labels after all fills, so a child never covers its parent's header.
    for (const c of cells) {
      const name = c.node.grouped ? groupedName(c.node) : c.node.name
      if (c.header) {
        ctx.font = `600 12px ${FONT}`
        ctx.fillStyle = palette.text
        const sizeText = formatBytes(c.node.alloc)
        ctx.font = `11px ${MONO}`
        const sw = ctx.measureText(sizeText).width
        ctx.font = `600 12px ${FONT}`
        const room = c.w - 16 - sw - 8
        const t = fit(ctx, name, room)
        if (t) ctx.fillText(t, c.x + 8, c.y + 13)
        if (room > 24) {
          ctx.font = `11px ${MONO}`
          ctx.fillStyle = palette.muted
          ctx.fillText(sizeText, c.x + c.w - 8 - sw, c.y + 13)
        }
        continue
      }
      const isLeaf = c.depth === 2 || !(c.node.children?.length && c.w > 48 && c.h > 40)
      if (!isLeaf || c.w < 56 || c.h < 30) continue
      ctx.font = `600 12px ${FONT}`
      ctx.fillStyle = palette.text
      const t = fit(ctx, name, c.w - 14)
      if (!t) continue
      ctx.fillText(t, c.x + 7, c.y + 17)
      if (c.h >= 44) {
        ctx.font = `11px ${MONO}`
        ctx.fillStyle = palette.muted
        ctx.fillText(fit(ctx, formatBytes(c.node.alloc), c.w - 14), c.x + 7, c.y + 32)
      }
    }

    // Draw-time stats for performance checks: on in dev, or with localStorage "perf" set.
    if (import.meta.env.DEV || safePerfFlag()) {
      ;(window as unknown as { __treemapStats: object }).__treemapStats = {
        cells: cells.length,
        drawMs: +(performance.now() - t0).toFixed(2)
      }
    }
  }, [cells, palette, size, colorMode, dark])

  const drawOverlay = (): void => {
    const ctx = prepare(overlay.current)
    if (!ctx) return
    ctx.clearRect(0, 0, size.w, size.h)
    const outline = (c: Cell, color: string, width: number): void => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.roundRect(c.x + 1 + width / 2, c.y + 1 + width / 2, c.w - 2 - width, c.h - 2 - width, c.depth === 1 ? 6 : 4)
      ctx.stroke()
    }
    const sel = selectedId !== null ? cells.find((c) => c.node.id === selectedId) : undefined
    if (sel) outline(sel, palette.selected, 2.5)
    if (hover.current && hover.current !== sel) outline(hover.current, palette.hover, 1.5)
  }

  // Overlay follows selection, layout and theme.
  useEffect(drawOverlay, [cells, selectedId, palette, size])

  const cellAt = (e: React.MouseEvent): Cell | null => {
    const r = base.current!.getBoundingClientRect()
    return hitTest(cells, e.clientX - r.left, e.clientY - r.top)
  }

  const onMove = (e: React.MouseEvent): void => {
    const r = base.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const c = hitTest(cells, x, y)
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      if (c !== hover.current) {
        hover.current = c
        drawOverlay()
      }
      setTip(c ? { x, y, cell: c } : null)
    })
  }

  const onLeave = (): void => {
    cancelAnimationFrame(raf.current)
    hover.current = null
    drawOverlay()
    setTip(null)
  }

  const tipNode = tip?.cell.node
  const tipLeft = tip ? Math.min(tip.x + 14, Math.max(0, size.w - 240)) : 0
  const tipTop = tip ? (tip.y + 70 > size.h ? tip.y - 62 : tip.y + 16) : 0

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden rounded-lg" role="img" aria-label={label}>
      <canvas ref={base} className="absolute inset-0" style={{ width: size.w, height: size.h }} />
      <canvas
        ref={overlay}
        className="absolute inset-0 cursor-pointer"
        style={{ width: size.w, height: size.h }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={(e) => {
          const c = cellAt(e)
          if (c && !c.node.grouped) onSelect(c.node)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          const c = cellAt(e)
          if (c && !c.node.grouped) {
            onSelect(c.node)
            onMenu?.(c.node)
          }
        }}
        onDoubleClick={(e) => {
          const c = cellAt(e)
          if (c && c.node.kind === 'dir' && !c.node.grouped && c.node.files > 0) onOpen(c.node)
        }}
      />
      {tipNode && (
        <div
          className="pointer-events-none absolute z-10 max-w-60 rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: tipLeft, top: tipTop }}
        >
          <div className="truncate font-medium">{tipNode.grouped ? groupedName(tipNode) : tipNode.name}</div>
          <div className="text-muted-foreground">
            {formatBytes(tipNode.alloc)}
            {tipNode.kind === 'dir' && ` · ${formatInt(tipNode.files)} arquivos`}
          </div>
        </div>
      )}
    </div>
  )
}
