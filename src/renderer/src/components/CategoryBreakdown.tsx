import { formatBytes, formatPercent } from '@/lib/format'
import { categoryChartColor, rankCategories } from '@/lib/categories'
import { cn } from '@/lib/utils'

interface CategoryBreakdownProps {
  /** Bytes per category index. */
  bytes: number[] | undefined
  /** How many categories to list (the rest are summed into the bar only). */
  limit?: number
  /** Bar only, with a short inline legend. */
  compact?: boolean
  className?: string
}

/** Stacked bar of bytes by file type, plus a legend. */
export function CategoryBreakdown({ bytes, limit = 6, compact, className }: CategoryBreakdownProps) {
  const ranked = rankCategories(bytes)
  const total = ranked.reduce((a, c) => a + c.bytes, 0)
  if (!total) return null

  const bar = (
    <div role="img" aria-label="Espaço por tipo de arquivo" className={cn('flex w-full gap-0.5 overflow-hidden rounded-full', compact ? 'h-2' : 'h-3')}>
      {ranked.map((c) => (
        <span
          key={c.key}
          title={`${c.label}: ${formatBytes(c.bytes)}`}
          className="block h-full"
          style={{ width: `${(c.bytes / total) * 100}%`, background: categoryChartColor(c.index), minWidth: 2 }}
        />
      ))}
    </div>
  )

  if (compact) {
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        {bar}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {ranked.slice(0, limit).map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: categoryChartColor(c.index) }} />
              {c.label} · {formatPercent(c.bytes, total)}
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {bar}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-x-6 gap-y-1.5">
        {ranked.slice(0, limit).map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-[13px]">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: categoryChartColor(c.index) }} />
            <span className="truncate text-muted-foreground">{c.label}</span>
            <span className="ml-auto whitespace-nowrap font-mono text-xs tabular-nums">{formatBytes(c.bytes)}</span>
            <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{formatPercent(c.bytes, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
