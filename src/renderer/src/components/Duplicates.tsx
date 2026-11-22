import { useEffect, useState } from 'react'
import { RiFileCopy2Line, RiLoader4Line, RiStopLine } from '@remixicon/react'
import type { DuplicateState } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UsageBar } from '@/components/ui/usage-bar'
import { formatBytes, formatDuration, formatInt } from '@/lib/format'
import { cn } from '@/lib/utils'

const SIZES = [
  { value: 1024 * 1024, label: '1 MB' },
  { value: 10 * 1024 * 1024, label: '10 MB' },
  { value: 100 * 1024 * 1024, label: '100 MB' }
]

interface DuplicatesProps {
  /** Changes when the tree changes (removals): results are re-read, already pruned by the main process. */
  dataKey: string
  selectedId: number | null
  onSelect: (id: number) => void
  onMenu: (id: number) => void
}

/** Finds identical files in the scan on display and lists them by space to win. */
export function Duplicates({ dataKey, selectedId, onSelect, onMenu }: DuplicatesProps) {
  const [state, setState] = useState<DuplicateState | null>(null)
  const [minSize, setMinSize] = useState(SIZES[1].value)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.duplicates.state().then(setState)
  }, [dataKey])

  useEffect(() => {
    const offs = [
      window.api.duplicates.onProgress((progress) => setState((s) => ({ running: true, result: s?.result ?? null, progress }))),
      window.api.duplicates.onDone((result) => setState({ running: false, progress: null, result })),
      window.api.duplicates.onError((message) => {
        setError(message)
        setState((s) => (s ? { ...s, running: false } : s))
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const start = async (): Promise<void> => {
    setError(null)
    setState({ running: true, progress: null, result: null })
    try {
      await window.api.duplicates.start(minSize)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState({ running: false, progress: null, result: null })
    }
  }

  const running = !!state?.running
  const p = state?.progress
  const r = state?.result

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 px-1 pt-1">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <span id="dup-min-size">Arquivos a partir de</span>
          <Select value={String(minSize)} disabled={running} onValueChange={(v) => setMinSize(Number(v))}>
            <SelectTrigger size="sm" aria-labelledby="dup-min-size" className="w-28 text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZES.map((s) => (
                <SelectItem key={s.value} value={String(s.value)}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {running ? (
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => void window.api.duplicates.cancel()}>
            <RiStopLine aria-hidden />
            Parar
          </Button>
        ) : (
          <Button size="sm" onClick={() => void start()}>
            <RiFileCopy2Line aria-hidden />
            {r ? 'Procurar de novo' : 'Procurar duplicados'}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          Compara tamanho, depois o início e o fim, e por fim o conteúdo inteiro. Hardlinks não contam como cópias.
        </span>
      </div>

      {error && <p className="selectable px-1 text-xs text-destructive">{error}</p>}

      {running && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm">
            <RiLoader4Line size={16} className="animate-spin" aria-hidden />
            {!p
              ? 'Agrupando arquivos do mesmo tamanho…'
              : p.phase === 'partial'
                ? `Comparando início e fim: ${formatInt(p.filesDone)} de ${formatInt(p.filesTotal)} arquivos`
                : `Comparando conteúdo: ${formatBytes(p.bytesDone)} de ${formatBytes(p.bytesTotal)}`}
            {p && <span className="ml-auto text-xs text-muted-foreground">{formatDuration(p.elapsedMs)}</span>}
          </div>
          {p && (
            <UsageBar
              value={p.phase === 'partial' ? p.filesDone : p.bytesDone}
              max={p.phase === 'partial' ? p.filesTotal : Math.max(1, p.bytesTotal)}
              className="h-2"
              label="Progresso da busca por duplicados"
            />
          )}
        </div>
      )}

      {r && !running && (
        <p className="px-1 text-[13px] text-muted-foreground">
          {r.totalGroups
            ? `${formatInt(r.totalGroups)} ${r.totalGroups === 1 ? 'grupo' : 'grupos'} de arquivos iguais · ${formatBytes(r.wasted)} ${r.wasted ? 'podem ser liberados' : ''}`
            : 'Nenhum arquivo duplicado encontrado'}{' '}
          · {formatInt(r.candidates)} arquivos comparados em {formatDuration(r.durationMs)}
          {r.cancelled && ' · busca interrompida, resultado parcial'}
          {r.totalGroups > r.groups.length && ` · mostrando os ${formatInt(r.groups.length)} maiores`}
        </p>
      )}

      {r && r.groups.length > 0 && (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {r.groups.map((g, gi) => (
            <li key={`${g.size}-${gi}`} className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/30 px-3 py-2 text-[13px]">
                <span className="font-medium">{formatInt(g.files.length)} cópias</span>
                <span className="text-muted-foreground">{formatBytes(g.size)} cada</span>
                <span className="ml-auto font-medium text-status-warn">{formatBytes(g.wasted)} desperdiçados</span>
              </div>
              <ul>
                {g.files.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(f.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        onSelect(f.id)
                        onMenu(f.id)
                      }}
                      className={cn(
                        'flex w-full min-w-0 flex-col px-3 py-1.5 text-left outline-none focus-visible:bg-accent',
                        f.id === selectedId ? 'bg-accent' : 'hover:bg-accent/50'
                      )}
                    >
                      <span className="truncate text-sm">{f.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground" title={f.path}>
                        {f.path}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {!r && !running && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <RiFileCopy2Line size={24} aria-hidden />
          Procure arquivos iguais espalhados pelo disco. Arquivos grandes demoram mais para comparar: você pode parar a
          qualquer momento e ver o que já foi encontrado.
        </div>
      )}
    </div>
  )
}
