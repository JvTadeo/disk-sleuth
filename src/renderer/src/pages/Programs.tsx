import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  RiApps2Line,
  RiGhostLine,
  RiStore2Line,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiDeleteBin2Line,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiRadarLine,
  RiRefreshLine,
  RiSearchLine,
  RiUninstallLine
} from '@remixicon/react'
import type { RemoveMode } from '@shared/ipc'
import type { Program, ProgramStatus, ReasonCode } from '@shared/programs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { formatBytes, formatInt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useApp, useAttentionCount } from '@/store/app'

type Filter = 'all' | ProgramStatus

const STATUS: Record<ProgramStatus, { label: string; variant: 'ok' | 'warn' | 'bad' }> = {
  reg: { label: 'Registrado', variant: 'ok' },
  unreg: { label: 'Não registrado', variant: 'warn' },
  orphan: { label: 'Órfão', variant: 'bad' }
}

const REASON: Record<ReasonCode, string> = {
  registered: 'Aparece em "Adicionar ou remover programas". Para remover, use o desinstalador oficial.',
  store: 'App da Microsoft Store. Aparece em Configurações › Aplicativos e é removido por lá.',
  systemComponent:
    'Registrado, mas o próprio Windows esconde da lista (componentes, runtimes e drivers). Normalmente não deve ser removido.',
  noRegistryWithExe:
    'Tem executáveis nesta pasta, mas nenhuma entrada no registro, por isso o Windows não lista. Costuma ser um programa portátil ou copiado sem instalador.',
  leftoverFolder:
    'Pasta de programa sem executáveis e sem nenhum programa instalado que seja dono dela. Parece resto de uma desinstalação.',
  leftoverData:
    'Pasta de dados grande que não corresponde a nenhum programa instalado. Pode ser resto de um programa desinstalado.',
  registryMissingFolder:
    'Ainda aparece no registro, mas a pasta de instalação e o desinstalador não existem mais. É uma entrada órfã.'
}

const TABS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'orphan', label: 'Órfãos' },
  { id: 'unreg', label: 'Não registrados' },
  { id: 'reg', label: 'Registrados' }
]

/** Icons are fetched once per program and kept for the session. */
const iconCache = new Map<string, string | null>()

function ProgramIcon({ p, size = 20 }: { p: Program; size?: number }) {
  const [url, setUrl] = useState<string | null | undefined>(() => iconCache.get(p.id))
  useEffect(() => {
    if (iconCache.has(p.id)) {
      setUrl(iconCache.get(p.id))
      return
    }
    let alive = true
    void window.api.programs
      .icon(p.id)
      .catch(() => null)
      .then((u) => {
        iconCache.set(p.id, u)
        if (alive) setUrl(u)
      })
    return () => {
      alive = false
    }
  }, [p.id])
  if (url) return <img src={url} alt="" width={size} height={size} className="shrink-0" draggable={false} />
  const Fallback = p.kind === 'store' ? RiStore2Line : p.status === 'orphan' ? RiGhostLine : RiApps2Line
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" style={{ width: size, height: size }}>
      <Fallback size={Math.round(size * 0.65)} aria-hidden />
    </span>
  )
}

function StatusBadge({ p }: { p: Program }) {
  const s = STATUS[p.status]
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={s.variant}>{s.label}</Badge>
      {p.confidence === 'likely' && (
        <span className="text-[11px] text-muted-foreground" title="Classificação por suposição: confira antes de apagar">
          provável
        </span>
      )}
    </span>
  )
}

function sizeText(p: Program): string {
  if (p.size === undefined) return '—'
  return `${p.sizeSource === 'registry' ? '~' : ''}${formatBytes(p.size)}`
}

function SourceRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      {ok ? (
        <RiCheckboxCircleLine size={18} className="text-status-ok" aria-label="Sim" />
      ) : (
        <RiCloseLine size={18} className="text-muted-foreground/60" aria-label="Não" />
      )}
      <span className={ok ? '' : 'text-muted-foreground'}>{label}</span>
    </div>
  )
}

/** Program actions shared by the details panel and the right-click menu. */
function useProgramActions() {
  const forgetProgram = useApp((s) => s.forgetProgram)
  const applyRemoval = useApp((s) => s.applyRemoval)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      await fn()
    } catch (err) {
      setNote(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  const uninstall = (p: Program): Promise<void> =>
    run(async () => {
      const r = await window.api.programs.uninstall(p.id)
      if (r.started) setNote('O desinstalador foi aberto. Quando terminar, clique em "Atualizar lista".')
    })

  const remove = (p: Program, mode: RemoveMode): Promise<void> =>
    run(async () => {
      const r = await window.api.programs.remove(p.id, mode)
      if (r.trashed) {
        forgetProgram(p.id)
        if (r.root) applyRemoval(r.root)
      }
    })

  const openFolder = (p: Program): Promise<void> => run(() => window.api.programs.openFolder(p.id))

  return { busy, note, setNote, uninstall, remove, openFolder }
}

type ProgramActions = ReturnType<typeof useProgramActions>

function Details({ p, actions }: { p: Program; actions: ProgramActions }) {
  const { busy, note, setNote } = actions
  useEffect(() => setNote(null), [p.id])
  const uninstall = (): Promise<void> => actions.uninstall(p)
  const remove = (mode: RemoveMode): Promise<void> => actions.remove(p, mode)

  return (
    <aside aria-label="Detalhes do programa" className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge p={p} />
          <ProgramIcon p={p} size={32} />
        </div>
        <h2 className="text-lg font-semibold leading-snug">{p.name}</h2>
        <span className="text-[13px] text-muted-foreground">
          {[p.publisher, p.version && `versão ${p.version}`, p.scope === 'user' && 'só para este usuário']
            .filter(Boolean)
            .join(' · ') || 'Fabricante desconhecido'}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed">{REASON[p.reason]}</p>
      {p.confidence === 'likely' && (
        <p className="rounded-md bg-status-warn/10 px-3 py-2 text-xs leading-relaxed text-status-warn">
          Classificação por suposição. Confira o conteúdo da pasta antes de apagar.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Onde encontramos</h3>
        <SourceRow ok={p.sources.registry} label="Entrada no registro (Uninstall)" />
        <SourceRow ok={p.sources.store} label="Microsoft Store" />
        <SourceRow ok={p.sources.folder} label="Pasta no disco" />
        <SourceRow ok={p.sources.shortcut} label="Atalho no Menu Iniciar" />
      </div>
      {p.location && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Local</h3>
          <code className="selectable block break-all rounded-md bg-muted px-2.5 py-2 font-mono text-xs">{p.location}</code>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted-foreground">Tamanho em disco</dt>
          <dd className="text-sm font-semibold tabular-nums">{sizeText(p)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Origem do tamanho</dt>
          <dd className="text-sm font-semibold">
            {p.sizeSource === 'scan' ? 'Varredura' : p.sizeSource === 'registry' ? 'Estimativa do registro' : '—'}
          </dd>
        </div>
      </dl>
      {(p.canUninstall || p.canTrash || (p.location && p.reason !== 'registryMissingFolder')) && (
      <div className="flex flex-wrap gap-2 border-t pt-4">
        {p.canUninstall && (
          <Button size="sm" disabled={busy} onClick={() => void uninstall()}>
            <RiUninstallLine aria-hidden />
            {p.kind === 'store' ? 'Abrir nas Configurações' : 'Desinstalar'}
          </Button>
        )}
        {p.location && p.reason !== 'registryMissingFolder' ? (
          <Button size="sm" variant="outline" onClick={() => void actions.openFolder(p)}>
            <RiExternalLinkLine aria-hidden />
            Abrir pasta
          </Button>
        ) : null}
        {p.canTrash && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void remove('trash')}
          >
            <RiDeleteBinLine aria-hidden />
            Mover para a Lixeira
          </Button>
        )}
        {p.canTrash && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove('delete')}>
            <RiDeleteBin2Line aria-hidden />
            Excluir permanentemente
          </Button>
        )}
      </div>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </aside>
  )
}

export default function Programs() {
  const result = useApp((s) => s.programs)
  const detecting = useApp((s) => s.detecting)
  const error = useApp((s) => s.programsError)
  const detect = useApp((s) => s.detectPrograms)
  const summary = useApp((s) => s.summary)
  const selectedDrive = useApp((s) => s.drives.find((d) => d.letter === s.selectedDrive))
  const startScan = useApp((s) => s.startScan)
  const attention = useAttentionCount()

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const q = useDeferredValue(query.trim().toLowerCase())

  // First visit: detect automatically.
  useEffect(() => {
    if (!result && !detecting) void detect()
  }, [result, detecting, detect])

  const visible = useMemo(() => (result?.programs ?? []).filter((p) => showHidden || !p.hidden), [result, showHidden])
  const counts = useMemo(() => {
    const c = { all: visible.length, reg: 0, unreg: 0, orphan: 0 }
    for (const p of visible) c[p.status]++
    return c
  }, [visible])
  const rows = useMemo(
    () =>
      visible.filter(
        (p) =>
          (filter === 'all' || p.status === filter) &&
          (!q || `${p.name} ${p.publisher ?? ''} ${p.location ?? ''}`.toLowerCase().includes(q))
      ),
    [visible, filter, q]
  )
  const selected = rows.find((p) => p.id === selectedId) ?? rows[0]
  const actions = useProgramActions()

  const openMenu = async (p: Program): Promise<void> => {
    const action = await window.api.programs.contextMenu(p.id).catch(() => null)
    if (action === 'uninstall') await actions.uninstall(p)
    else if (action === 'folder') await actions.openFolder(p)
    else if (action === 'trash' || action === 'delete') await actions.remove(p, action)
  }

  if (result && !result.supported) {
    return (
      <>
        <PageHeader title="Programas" />
        <EmptyState icon={RiApps2Line} title="Disponível apenas no Windows">
          A detecção lê o registro do Windows, os apps da Microsoft Store e os atalhos do Menu Iniciar.
        </EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Programas"
        subtitle={
          result
            ? `${formatInt(counts.all)} programas encontrados no registro, na Store, nas pastas e nos atalhos · ${formatInt(attention)} precisam de atenção`
            : 'Procurando programas…'
        }
        actions={
          <Button variant="outline" disabled={detecting} onClick={() => void detect()}>
            {detecting ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiRefreshLine aria-hidden />}
            {detecting ? 'Procurando…' : 'Atualizar lista'}
          </Button>
        }
      />

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 text-sm">
            <RiErrorWarningLine size={20} className="shrink-0 text-destructive" aria-hidden />
            <span className="selectable">{error}</span>
          </CardContent>
        </Card>
      )}
      {result?.warnings.map((w) => (
        <p key={w} className="selectable rounded-md bg-status-warn/10 px-3 py-2 text-xs text-status-warn">
          {w}
        </p>
      ))}
      {result && !result.usedScan && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
          <RiRadarLine size={18} aria-hidden />
          <span className="flex-1">
            {summary
              ? 'A varredura atual não cobre estes programas.'
              : 'Sem varredura do disco: os tamanhos são estimativas do registro e restos em AppData/ProgramData não são procurados.'}
          </span>
          {selectedDrive && !summary && (
            <Button size="sm" variant="outline" onClick={() => void startScan(selectedDrive.root)}>
              Escanear {selectedDrive.letter}:
            </Button>
          )}
        </div>
      )}

      {!result ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
          <RiLoader4Line size={28} className="animate-spin text-muted-foreground" aria-hidden />
          <p className="max-w-md text-sm text-muted-foreground">
            Lendo o registro do Windows, os apps da Microsoft Store, as pastas de programas e os atalhos do Menu Iniciar.
            Leva alguns segundos.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Filtrar por estado" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-[3px]">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === t.id}
                  onClick={() => setFilter(t.id)}
                  className={cn(
                    'inline-flex h-7.5 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    filter === t.id ? 'bg-background text-foreground shadow-xs dark:bg-input/40' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                  <span className="text-xs text-muted-foreground tabular-nums">{counts[t.id]}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                  className="size-4 accent-[var(--brand)]"
                />
                Mostrar componentes do sistema
              </label>
              <label className="flex h-9 w-72 items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground dark:bg-input/30">
                <RiSearchLine size={16} aria-hidden />
                <span className="sr-only">Buscar programa</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por nome, fabricante ou pasta…"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
            </div>
          </div>

          <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(300px,360px)] items-start gap-4">
            <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <div className="grid grid-cols-[minmax(0,1.5fr)_150px_84px_minmax(0,1.6fr)] gap-4 border-b bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground">
                <span>Nome</span>
                <span>Estado</span>
                <span className="text-right">Tamanho</span>
                <span>Local</span>
              </div>
              <ul className="max-h-[calc(100vh-330px)] min-h-40 overflow-y-auto">
                {rows.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={p.id === selected?.id}
                      onClick={() => setSelectedId(p.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setSelectedId(p.id)
                        void openMenu(p)
                      }}
                      className={cn(
                        'grid w-full grid-cols-[minmax(0,1.5fr)_150px_84px_minmax(0,1.6fr)] items-center gap-4 border-b border-border/50 px-4 py-2.5 text-left outline-none focus-visible:bg-accent',
                        p.id === selected?.id ? 'bg-accent' : 'hover:bg-accent/50'
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <ProgramIcon p={p} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">{p.name}</span>
                          <span className="truncate text-xs text-muted-foreground">{p.publisher ?? '—'}</span>
                        </span>
                      </span>
                      <StatusBadge p={p} />
                      <span className="text-right font-mono text-[13px] tabular-nums">{sizeText(p)}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground" title={p.location}>
                        {p.location ?? '—'}
                      </span>
                    </button>
                  </li>
                ))}
                {!rows.length && (
                  <li className="px-4 py-12 text-center text-sm text-muted-foreground">Nenhum programa com esse filtro.</li>
                )}
              </ul>
              <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                Mostrando {formatInt(rows.length)} de {formatInt(counts.all)} · detecção em{' '}
                {(result.durationMs / 1000).toFixed(1).replace('.', ',')} s
              </div>
            </div>
            {selected ? (
              <Details p={selected} actions={actions} />
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Selecione um programa.
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}
