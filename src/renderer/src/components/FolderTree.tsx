import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { RiArrowRightSLine, RiFileLine, RiFolder3Line, RiFolderOpenLine, RiStackLine } from '@remixicon/react'
import type { ScanNode } from '@shared/scan'
import { formatBytes, formatInt } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Row {
  node: ScanNode
  depth: number
  /** Placeholder row while a folder's children load. */
  loading?: boolean
}

interface FolderTreeProps {
  rootId: number
  /** Changes whenever the tree data changes (new scan, item removed): drops the cache. */
  dataKey: string
  /** Folder currently shown in the treemap. */
  currentId: number | null
  selectedId: number | null
  /** Ancestors to expand so the current folder is visible. */
  expandTo: number[]
  onSelect: (node: ScanNode) => void
  /** Right-click on a row. */
  onMenu?: (node: ScanNode) => void
}

const ROW_HEIGHT = 32

/**
 * Expandable folder tree. Children load lazily from the scanner process, and only the rows
 * on screen exist in the DOM (virtualized), so a folder with 50k entries scrolls as smoothly as one with 5.
 */
export function FolderTree({ rootId, dataKey, currentId, selectedId, expandTo, onSelect, onMenu }: FolderTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cache = useRef(new Map<number, ScanNode[]>())
  const inflight = useRef(new Set<number>())
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([rootId]))
  const [version, setVersion] = useState(0)

  const ensure = useCallback((id: number): void => {
    if (cache.current.has(id) || inflight.current.has(id)) return
    inflight.current.add(id)
    void window.api.scan.children(id).then((r) => {
      inflight.current.delete(id)
      cache.current.set(id, r?.children ?? [])
      setVersion((v) => v + 1)
    })
  }, [])

  // New data: forget everything and start from the root again.
  useEffect(() => {
    cache.current = new Map()
    inflight.current = new Set()
    setExpanded(new Set([rootId]))
    ensure(rootId)
  }, [rootId, dataKey, ensure])

  // Reveal the current folder.
  useEffect(() => {
    if (!expandTo.length) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of expandTo) next.add(id)
      return next
    })
    for (const id of expandTo) ensure(id)
  }, [expandTo, ensure])

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (id: number, depth: number): void => {
      const kids = cache.current.get(id)
      if (!kids) {
        out.push({ node: { id: -2, name: '', kind: 'dir', size: 0, alloc: 0, files: 0 }, depth, loading: true })
        return
      }
      for (const k of kids) {
        out.push({ node: k, depth })
        if (expanded.has(k.id)) walk(k.id, depth + 1)
      }
    }
    walk(rootId, 0)
    return out
    // `version` bumps when the cache fills in.
  }, [rootId, expanded, version])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  // Scroll the current folder into view when it changes from outside (treemap, breadcrumbs).
  // Its row may only appear after the ancestors load, so the request waits until then.
  const pendingScroll = useRef<number | null>(null)
  useEffect(() => {
    pendingScroll.current = currentId
  }, [currentId])
  useEffect(() => {
    const target = pendingScroll.current
    if (target === null) return
    const i = rows.findIndex((r) => r.node.id === target)
    if (i >= 0) {
      pendingScroll.current = null
      virtualizer.scrollToIndex(i, { align: 'auto' })
    }
  }, [rows, currentId, virtualizer])

  const toggle = (id: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else {
        next.add(id)
        ensure(id)
      }
      return next
    })
  }

  return (
    <div ref={scrollRef} role="tree" aria-label="Pastas" className="h-full overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const { node, depth, loading } = rows[v.index]
          const style = { transform: `translateY(${v.start}px)`, height: ROW_HEIGHT }
          if (loading) {
            return (
              <div key={`loading-${v.index}`} className="absolute inset-x-0 top-0 flex items-center px-2" style={style}>
                <span className="h-3 w-32 animate-pulse rounded bg-muted" style={{ marginLeft: depth * 16 + 24 }} />
              </div>
            )
          }
          const expandable = node.kind === 'dir' && !node.grouped && node.files > 0
          const isOpen = expanded.has(node.id)
          const Icon = node.grouped ? RiStackLine : node.kind === 'file' ? RiFileLine : isOpen ? RiFolderOpenLine : RiFolder3Line
          const selected = node.id === selectedId
          const current = node.id === currentId
          return (
            <div
              key={`${node.id}-${v.index}`}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={expandable ? isOpen : undefined}
              aria-selected={selected}
              className="absolute inset-x-0 top-0 px-1"
              style={style}
            >
              <div
                className={cn(
                  'flex h-full items-center gap-1 rounded-md pr-2 text-sm',
                  selected ? 'bg-accent' : current ? 'bg-accent/50' : 'hover:bg-accent/40'
                )}
                style={{ paddingLeft: depth * 16 }}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={isOpen ? 'Recolher' : 'Expandir'}
                  disabled={!expandable}
                  onClick={() => toggle(node.id)}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:invisible"
                >
                  <RiArrowRightSLine size={16} className={cn('transition-transform', isOpen && 'rotate-90')} aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={!!node.grouped}
                  onClick={() => onSelect(node)}
                  onDoubleClick={() => expandable && toggle(node.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (node.grouped) return
                    onSelect(node)
                    onMenu?.(node)
                  }}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline disabled:cursor-default"
                >
                  <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                  <span className={cn('min-w-0 flex-1 truncate', node.grouped && 'text-muted-foreground', current && 'font-medium')}>
                    {node.grouped ? `${formatInt(node.groupedCount ?? 0)} itens menores` : node.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatBytes(node.alloc)}
                  </span>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
