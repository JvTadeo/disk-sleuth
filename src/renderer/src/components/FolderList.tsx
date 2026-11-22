import { RiFileLine, RiFolder3Line, RiStackLine } from '@remixicon/react'
import type { ScanNode } from '@shared/scan'
import { UsageBar } from '@/components/ui/usage-bar'
import { formatBytes, formatInt, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

interface FolderListProps {
  items: ScanNode[]
  /** Size of the folder being listed, for the percentage column. */
  total: number
  onOpen?: (node: ScanNode) => void
  compact?: boolean
}

/** Folder contents, largest first, with a bar relative to the biggest item. */
export function FolderList({ items, total, onOpen, compact }: FolderListProps) {
  const max = items[0]?.alloc ?? 0
  return (
    <ul className="flex flex-col">
      {items.map((n) => {
        const openable = n.kind === 'dir' && !n.grouped && n.files > 0 && !!onOpen
        const Icon = n.grouped ? RiStackLine : n.kind === 'dir' ? RiFolder3Line : RiFileLine
        const label = n.grouped ? `${formatInt(n.groupedCount ?? 0)} itens menores` : n.name
        return (
          <li key={`${n.id}-${n.name}`}>
            <button
              type="button"
              disabled={!openable}
              onClick={() => openable && onOpen?.(n)}
              className={cn(
                'grid w-full grid-cols-[minmax(0,1fr)_76px_44px] items-center gap-x-3 gap-y-1.5 rounded-md px-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                compact ? 'py-2' : 'py-2.5',
                openable ? 'cursor-pointer hover:bg-accent/60' : 'cursor-default disabled:opacity-100'
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className={cn('truncate', n.grouped && 'text-muted-foreground')}>{label}</span>
                {!compact && n.kind === 'dir' && !n.grouped && (
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {formatInt(n.files)} arq.
                  </span>
                )}
              </span>
              <span className="text-right font-mono text-[13px] tabular-nums">{formatBytes(n.alloc)}</span>
              <span className="text-right text-xs text-muted-foreground tabular-nums">{formatPercent(n.alloc, total)}</span>
              <UsageBar value={n.alloc} max={max} className="col-span-3 h-1" label={`Tamanho de ${label}`} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
