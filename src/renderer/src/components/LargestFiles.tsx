import { useEffect, useState } from 'react'
import { RiFileLine } from '@remixicon/react'
import type { NodeInfo } from '@shared/scan'
import { UsageBar } from '@/components/ui/usage-bar'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

interface LargestFilesProps {
  dataKey: string
  selectedId: number | null
  onSelect: (info: NodeInfo) => void
  onMenu?: (info: NodeInfo) => void
}

/** The 100 largest files of the whole scan, wherever they are. */
export function LargestFiles({ dataKey, selectedId, onSelect, onMenu }: LargestFilesProps) {
  const [items, setItems] = useState<NodeInfo[] | null>(null)

  useEffect(() => {
    let stale = false
    setItems(null)
    void window.api.scan.largestFiles().then((r) => {
      if (!stale) setItems(r)
    })
    return () => {
      stale = true
    }
  }, [dataKey])

  if (!items) return <div className="h-full animate-pulse rounded-lg bg-muted/40" />
  if (!items.length) return <p className="p-6 text-center text-sm text-muted-foreground">Nenhum arquivo encontrado.</p>

  const max = items[0].node.alloc
  return (
    <ul className="flex h-full flex-col overflow-y-auto">
      {items.map((it, i) => (
        <li key={it.node.id}>
          <button
            type="button"
            onClick={() => onSelect(it)}
            onContextMenu={(e) => {
              e.preventDefault()
              onSelect(it)
              onMenu?.(it)
            }}
            className={cn(
              'grid w-full grid-cols-[28px_minmax(0,1fr)_84px] items-center gap-x-3 gap-y-1 rounded-md px-2.5 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              it.node.id === selectedId ? 'bg-accent' : 'hover:bg-accent/50'
            )}
          >
            <span className="text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <RiFileLine size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{it.node.name}</span>
              </span>
              <span className="truncate pl-6 font-mono text-[11px] text-muted-foreground" title={it.path}>
                {it.path}
              </span>
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums">{formatBytes(it.node.alloc)}</span>
            <UsageBar value={it.node.alloc} max={max} className="col-start-2 col-end-4 h-1" label={`Tamanho de ${it.node.name}`} />
          </button>
        </li>
      ))}
    </ul>
  )
}
