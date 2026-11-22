import { useEffect, useMemo, useRef, useState } from 'react'
import {
  RiBox3Line,
  RiCheckboxCircleLine,
  RiCodeSSlashLine,
  RiDeleteBin2Line,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiRadarLine,
  RiRefreshLine
} from '@remixicon/react'
import type { RemoveMode } from '@shared/ipc'
import type { DevCache, DevCleanResult, DevProject, DevTool } from '@shared/devjunk'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { formatBytes, formatInt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { cleanError, useApp } from '@/store/app'

type Tab = 'all' | 'proj' | 'cache'

const DAY = 24 * 60 * 60 * 1000
const STALE_DAYS = 90

const TOOLS: Record<DevTool, string> = {
  node: 'Node.js',
  rust: 'Rust',
  dotnet: '.NET',
  python: 'Python',
  gradle: 'Gradle',
  maven: 'Maven',
  flutter: 'Flutter',
  unity: 'Unity'
}

const AGES: { days: number; label: string }[] = [
  { days: 0, label: 'Qualquer' },
  { days: 30, label: '1 mês' },
  { days: 90, label: '3 meses' },
  { days: 180, label: '6 meses' },
  { days: 365, label: '1 ano' }
]

/** Selection keys: one per rebuildable folder ("a:<nodeId>") or cache ("c:<id>"). */
const artKey = (nodeId: number): string => `a:${nodeId}`
const cacheKey = (id: string): string => `c:${id}`

function daysSince(ms: number | null): number | null {
  return ms === null ? null : Math.max(0, Math.floor((Date.now() - ms) / DAY))
}

/** "hoje", "há 3 dias", "há 5 meses", "há 1 ano e 2 meses". */
function ago(ms: number | null): string {
  const days = daysSince(ms)
  if (days === null) return '—'
  if (days < 1) return 'hoje'
  if (days < 2) return 'ontem'
  if (days < 14) return `há ${days} dias`
  if (days < 60) return `há ${Math.round(days / 7)} semanas`
  const months = Math.round(days / 30.44)
  if (months < 12) return `há ${months} meses`
  const y = Math.floor(months / 12)
  const m = months % 12
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}${m ? ` e ${m} ${m === 1 ? 'mês' : 'meses'}` : ''}`
}

/** A real checkbox that can also show "some selected". */
function Check({
  checked,
  mixed = false,
  label,
  onChange
}: {
  checked: boolean
  mixed?: boolean
  label: string
  onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed
  }, [mixed])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="size-4 cursor-pointer accent-[var(--brand)]"
    />
  )
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3.5 shadow-xs">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

function Segmented<T extends string | number>({
  items,
  value,
  onChange,
  label,
  role
}: {
  items: { id: T; label: string; count?: number }[]
  value: T
  onChange: (v: T) => void
  label: string
  role: 'tab' | 'radio'
}) {
  return (
    <div role={role === 'tab' ? 'tablist' : 'radiogroup'} aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-[3px]">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role={role}
          aria-selected={role === 'tab' ? value === it.id : undefined}
          aria-checked={role === 'radio' ? value === it.id : undefined}
          onClick={() => onChange(it.id)}
          className={cn(
            'inline-flex h-7.5 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            value === it.id ? 'bg-background text-foreground shadow-xs dark:bg-input/40' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {it.label}
          {it.count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

type Row = { kind: 'proj'; key: string; p: DevProject } | { kind: 'cache'; key: string; c: DevCache }

function ProjectDetails({
  p,
  name,
  picked,
  toggle,
  onOpen
}: {
  p: DevProject
  name: string
  picked: Set<string>
  toggle: (keys: string[]) => void
  onOpen: () => void
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {p.tools.map((t) => (
            <Badge key={t} variant="secondary">
              {TOOLS[t]}
            </Badge>
          ))}
        </div>
        <h2 className="text-lg font-semibold leading-snug">{name}</h2>
        <span className="text-[13px] text-muted-foreground">
          {p.lastActivity ? `Arquivos do projeto alterados pela última vez ${ago(p.lastActivity)}` : 'Última alteração desconhecida'}
        </span>
      </div>
      <code className="selectable block break-all rounded-md bg-muted px-2.5 py-2 font-mono text-xs">{p.path}</code>
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">O que pode sair</h3>
        {p.artifacts.map((a) => (
          <label key={a.nodeId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 px-3 py-2.5 hover:bg-accent/40">
            <span className="pt-0.5">
              <Check checked={picked.has(artKey(a.nodeId))} label={`Selecionar ${a.name}`} onChange={() => toggle([artKey(a.nodeId)])} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[13px] font-medium">{a.name}</span>
                <span className="font-mono text-[13px] tabular-nums">{formatBytes(a.alloc)}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                Recriado com <code className="rounded bg-muted px-1 py-px font-mono text-[11px] text-foreground">{a.rebuild}</code>
                {' · '}
                {formatInt(a.files)} arquivos
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="rounded-md bg-status-ok/10 px-3 py-2 text-xs leading-relaxed text-status-ok">
        Só as pastas marcadas saem. O código-fonte e os arquivos do projeto ficam intactos.
      </p>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button size="sm" variant="outline" onClick={onOpen}>
          <RiExternalLinkLine aria-hidden />
          Abrir pasta
        </Button>
      </div>
    </>
  )
}

function CacheDetails({ c, onOpen }: { c: DevCache; onOpen: () => void }) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex">
          <Badge variant="secondary">Cache global</Badge>
        </div>
        <h2 className="text-lg font-semibold leading-snug">{c.name}</h2>
        <span className="text-[13px] text-muted-foreground">Compartilhado por todos os projetos</span>
      </div>
      <code className="selectable block break-all rounded-md bg-muted px-2.5 py-2 font-mono text-xs">{c.path}</code>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted-foreground">Tamanho em disco</dt>
          <dd className="text-sm font-semibold tabular-nums">{c.alloc === null ? '—' : formatBytes(c.alloc)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Arquivos</dt>
          <dd className="text-sm font-semibold tabular-nums">{c.files === null ? '—' : formatInt(c.files)}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Como é limpo</h3>
        {c.command ? (
          <p className="text-[13px] leading-relaxed">
            Com o comando oficial{' '}
            <code className="rounded bg-muted px-1 py-px font-mono text-xs">{c.command}</code>. Se a ferramenta não estiver
            instalada, a pasta é esvaziada.
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed">A pasta é esvaziada (a ferramenta não tem um comando de limpeza).</p>
        )}
      </div>
      <p className="rounded-md bg-status-ok/10 px-3 py-2 text-xs leading-relaxed text-status-ok">{c.note}</p>
      <p className="text-xs text-muted-foreground">Caches são limpos direto, sem passar pela Lixeira.</p>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button size="sm" variant="outline" onClick={onOpen}>
          <RiExternalLinkLine aria-hidden />
          Abrir pasta
        </Button>
      </div>
    </>
  )
}

export default function DevJunk() {
  const result = useApp((s) => s.devJunk)
  const scanning = useApp((s) => s.devScanning)
  const error = useApp((s) => s.devError)
  const scanDev = useApp((s) => s.scanDevJunk)
  const setDevJunk = useApp((s) => s.setDevJunk)
  const applyRemoval = useApp((s) => s.applyRemoval)
  const summary = useApp((s) => s.summary)
  const diskScanning = useApp((s) => s.scanStatus === 'scanning')
  const selectedDrive = useApp((s) => s.drives.find((d) => d.letter === s.selectedDrive))
  const startScan = useApp((s) => s.startScan)

  const [tab, setTab] = useState<Tab>('all')
  const [age, setAge] = useState(STALE_DAYS)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [outcome, setOutcome] = useState<DevCleanResult | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Look again whenever the scan on display changed since the last list (or there is no list yet).
  const scanKey = summary && !summary.cancelled ? summary.finishedAt : null
  useEffect(() => {
    if (diskScanning || scanning) return
    if (!result || result.scanKey !== scanKey) void scanDev()
  }, [scanKey, diskScanning]) // the list itself is not a trigger: cleaning updates it in place

  const projects = useMemo(() => result?.projects ?? [], [result])
  const caches = useMemo(() => result?.caches ?? [], [result])

  // A project inside another one (an Android "app" module, a monorepo package) is named after its parent too.
  const displayName = useMemo(() => {
    const names = new Map<string, string>()
    for (const p of projects) {
      const parent = projects
        .filter((o) => o !== p && p.id.startsWith(o.id + (o.id.includes('\\') ? '\\' : '/')))
        .sort((a, b) => b.id.length - a.id.length)[0]
      names.set(p.id, parent ? `${parent.name} › ${p.path.slice(parent.path.length + 1).replace(/[\\/]/g, ' › ')}` : p.name)
    }
    return names
  }, [projects])

  /** Changed more recently than the age filter: hidden from the list. */
  const fresh = (p: DevProject): boolean => {
    const d = daysSince(p.lastActivity)
    return age > 0 && d !== null && d < age
  }
  const visibleProjects = useMemo(() => projects.filter((p) => !fresh(p)), [projects, age])
  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    if (tab !== 'cache') for (const p of visibleProjects) out.push({ kind: 'proj', key: `p:${p.id}`, p })
    if (tab !== 'proj') for (const c of caches) out.push({ kind: 'cache', key: cacheKey(c.id), c })
    const size = (r: Row): number => (r.kind === 'proj' ? r.p.alloc : (r.c.alloc ?? 0))
    return out.sort((a, b) => size(b) - size(a))
  }, [visibleProjects, caches, tab])

  const selected = rows.find((r) => r.key === selectedKey) ?? rows[0]

  const sum = (list: { alloc: number | null }[]): number => list.reduce((a, x) => a + (x.alloc ?? 0), 0)
  const stale = projects.filter((p) => {
    const d = daysSince(p.lastActivity)
    return d === null || d >= STALE_DAYS
  })
  const total = sum(projects) + sum(caches)

  // What the selection adds up to (only items still in the list count).
  const pickedArtifacts = projects.flatMap((p) => p.artifacts).filter((a) => picked.has(artKey(a.nodeId)))
  const pickedCaches = caches.filter((c) => picked.has(cacheKey(c.id)))
  const pickedCount = pickedArtifacts.length + pickedCaches.length
  const pickedBytes = sum(pickedArtifacts) + sum(pickedCaches)

  const toggle = (keys: string[]): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      const allOn = keys.every((k) => next.has(k))
      for (const k of keys) {
        if (allOn) next.delete(k)
        else next.add(k)
      }
      return next
    })
  }
  const keysOf = (r: Row): string[] => (r.kind === 'proj' ? r.p.artifacts.map((a) => artKey(a.nodeId)) : [r.key])

  const clean = async (mode: RemoveMode): Promise<void> => {
    setCleaning(true)
    setActionError(null)
    setOutcome(null)
    try {
      const r = await window.api.dev.clean(
        { artifacts: pickedArtifacts.map((a) => a.nodeId), caches: pickedCaches.map((c) => c.id) },
        mode
      )
      if (!r.done) return
      setOutcome(r)
      setDevJunk(r.result)
      if (r.root) applyRemoval(r.root)
      setPicked(new Set())
    } catch (err) {
      setActionError(cleanError(err))
    } finally {
      setCleaning(false)
    }
  }

  const open = (id: string): void => {
    void window.api.dev.openFolder(id).catch((err) => setActionError(cleanError(err)))
  }

  const noScan = !summary || summary.cancelled

  return (
    <>
      <PageHeader
        title="Lixo de dev"
        subtitle={
          result
            ? noScan
              ? 'Pastas que um comando recria · só caches por enquanto: escaneie a unidade dos seus projetos'
              : `Pastas que um comando recria · baseado na varredura de ${result.root ?? summary?.root ?? ''}`
            : 'Procurando pastas de projeto e caches…'
        }
        actions={
          <Button variant="outline" disabled={scanning || diskScanning} onClick={() => void scanDev()}>
            {scanning ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiRefreshLine aria-hidden />}
            {scanning ? 'Procurando…' : 'Atualizar'}
          </Button>
        }
      />

      {(error || actionError) && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 text-sm">
            <RiErrorWarningLine size={20} className="shrink-0 text-destructive" aria-hidden />
            <span className="selectable">{actionError ?? error}</span>
          </CardContent>
        </Card>
      )}

      {outcome && (
        <div role="status" className="flex flex-col gap-1 rounded-lg border border-status-ok/30 bg-status-ok/10 px-4 py-3 text-[13px]">
          <span className="flex items-center gap-2 font-medium text-status-ok">
            <RiCheckboxCircleLine size={18} aria-hidden />
            {formatBytes(outcome.freed)} liberados
            {outcome.failed > 0 && ` · ${outcome.failed} ${outcome.failed === 1 ? 'item não pôde' : 'itens não puderam'} ser limpos`}
          </span>
          {outcome.notes.map((n) => (
            <span key={n} className="selectable text-xs text-muted-foreground">
              {n}
            </span>
          ))}
        </div>
      )}

      {noScan && !diskScanning && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
          <RiRadarLine size={18} aria-hidden />
          <span className="flex-1">
            Os projetos são encontrados na varredura do disco. Escaneie a unidade onde ficam seus projetos para ver as pastas
            node_modules, target, bin e as outras.
          </span>
          {selectedDrive && (
            <Button size="sm" variant="outline" onClick={() => void startScan(selectedDrive.root)}>
              Escanear {selectedDrive.letter}:
            </Button>
          )}
        </div>
      )}

      {!result ? (
        diskScanning ? (
          <EmptyState icon={RiLoader4Line} title="Varredura em andamento">
            Quando a varredura terminar, os projetos aparecem aqui.
          </EmptyState>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
            <RiLoader4Line size={28} className="animate-spin text-muted-foreground" aria-hidden />
            <p className="max-w-md text-sm text-muted-foreground">
              Procurando node_modules, pastas de build e ambientes virtuais na varredura, e medindo os caches do npm, pip,
              NuGet, Gradle e outros. Leva alguns segundos.
            </p>
          </div>
        )
      ) : !projects.length && !caches.length ? (
        <EmptyState icon={RiCodeSSlashLine} title="Nada para limpar">
          Nenhuma pasta de projeto recriável nem cache de ferramenta de desenvolvimento ocupando espaço.
        </EmptyState>
      ) : (
        <>
          <section aria-label="Resumo" className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            <SummaryCard
              label="Pode ser liberado"
              value={formatBytes(total)}
              hint={`${formatInt(projects.reduce((a, p) => a + p.artifacts.length, 0) + caches.length)} itens que um comando recria`}
            />
            <SummaryCard
              label="Projetos parados há 3+ meses"
              value={formatBytes(sum(stale))}
              hint={`${formatInt(stale.length)} ${stale.length === 1 ? 'projeto' : 'projetos'}`}
            />
            <SummaryCard
              label="Caches globais"
              value={formatBytes(sum(caches))}
              hint={caches.length ? caches.map((c) => c.name.replace(/^(Cache|Store|Pacotes|Registro|Repositório|Downloads) d[oe] /, '')).slice(0, 4).join(', ') : 'nenhum encontrado'}
            />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented<Tab>
              role="tab"
              label="Tipo"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'all', label: 'Tudo', count: visibleProjects.length + caches.length },
                { id: 'proj', label: 'Projetos', count: visibleProjects.length },
                { id: 'cache', label: 'Caches globais', count: caches.length }
              ]}
            />
            <div className={cn('flex flex-wrap items-center gap-2', tab === 'cache' && 'opacity-50')}>
              <span className="text-[13px] text-muted-foreground">Projetos parados há mais de</span>
              <Segmented<number>
                role="radio"
                label="Tempo sem alterações"
                value={age}
                onChange={setAge}
                items={AGES.map((a) => ({ id: a.days, label: a.label }))}
              />
            </div>
          </div>

          <section className="grid min-h-80 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,360px)] grid-rows-[minmax(0,1fr)] gap-4">
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
              <div className="grid shrink-0 grid-cols-[44px_minmax(0,1.5fr)_minmax(0,1fr)_120px_84px] gap-4 border-b bg-muted/40 py-2.5 pr-4 text-xs font-medium text-muted-foreground">
                <span />
                <span>Projeto ou cache</span>
                <span>O que sai</span>
                <span>Última alteração</span>
                <span className="text-right">Tamanho</span>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {rows.map((r) => {
                  const keys = keysOf(r)
                  const on = keys.filter((k) => picked.has(k)).length
                  const isSel = r.key === selected?.key
                  const old = r.kind === 'proj' && (daysSince(r.p.lastActivity) ?? 0) >= 180
                  const name = r.kind === 'proj' ? (displayName.get(r.p.id) ?? r.p.name) : r.c.name
                  return (
                    <li
                      key={r.key}
                      className={cn('grid grid-cols-[44px_minmax(0,1fr)] border-b border-border/50', isSel ? 'bg-accent' : 'hover:bg-accent/50')}
                    >
                      <span className="flex items-center justify-center">
                        <Check checked={on === keys.length} mixed={on > 0 && on < keys.length} label={`Selecionar ${name}`} onChange={() => toggle(keys)} />
                      </span>
                      <button
                        type="button"
                        aria-pressed={isSel}
                        onClick={() => setSelectedKey(r.key)}
                        className="grid min-w-0 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_120px_84px] items-center gap-4 py-2.5 pr-4 text-left outline-none focus-visible:bg-accent"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          {r.kind === 'cache' && <RiBox3Line size={16} className="shrink-0 text-muted-foreground" aria-hidden />}
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-medium">{name}</span>
                            <span className="truncate font-mono text-[11px] text-muted-foreground" title={r.kind === 'proj' ? r.p.path : r.c.path}>
                              {r.kind === 'proj' ? r.p.path : r.c.path}
                            </span>
                          </span>
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {r.kind === 'proj' ? r.p.artifacts.map((a) => a.name).join('  ·  ') : (r.c.command ?? 'esvaziar a pasta')}
                        </span>
                        <span className={cn('text-[13px]', r.kind === 'cache' ? 'text-muted-foreground' : old ? 'text-status-warn' : '')}>
                          {r.kind === 'proj' ? ago(r.p.lastActivity) : 'cache global'}
                        </span>
                        <span className="text-right font-mono text-[13px] tabular-nums">
                          {formatBytes(r.kind === 'proj' ? r.p.alloc : (r.c.alloc ?? 0))}
                        </span>
                      </button>
                    </li>
                  )
                })}
                {!rows.length && (
                  <li className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {tab === 'cache' ? 'Nenhum cache encontrado.' : 'Nenhum projeto parado há tanto tempo.'}
                  </li>
                )}
              </ul>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-4 py-2.5">
                <span className="text-[13px]">
                  {pickedCount ? (
                    <>
                      <span className="font-semibold">
                        {formatInt(pickedCount)} {pickedCount === 1 ? 'item selecionado' : 'itens selecionados'}
                      </span>
                      {' · '}
                      <span className="font-mono font-semibold tabular-nums">{formatBytes(pickedBytes)}</span> a liberar
                    </>
                  ) : (
                    <span className="text-muted-foreground">Marque os itens que quer limpar</span>
                  )}
                </span>
                <div className="flex flex-wrap gap-2">
                  {pickedCount > 0 && (
                    <Button size="sm" variant="ghost" disabled={cleaning} onClick={() => setPicked(new Set())}>
                      Limpar seleção
                    </Button>
                  )}
                  <Button size="sm" disabled={!pickedCount || cleaning} onClick={() => void clean('trash')}>
                    {cleaning ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiDeleteBinLine aria-hidden />}
                    {cleaning ? 'Limpando…' : 'Mover para a Lixeira'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!pickedCount || cleaning}
                    className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void clean('delete')}
                  >
                    <RiDeleteBin2Line aria-hidden />
                    Excluir permanentemente
                  </Button>
                </div>
              </div>
            </div>
            {selected ? (
              <aside aria-label="Detalhes" className="flex max-h-full flex-col gap-4 self-start overflow-y-auto rounded-xl border bg-card p-5 shadow-xs">
                {selected.kind === 'proj' ? (
                  <ProjectDetails
                    p={selected.p}
                    name={displayName.get(selected.p.id) ?? selected.p.name}
                    picked={picked}
                    toggle={toggle}
                    onOpen={() => open(selected.p.id)}
                  />
                ) : (
                  <CacheDetails c={selected.c} onOpen={() => open(selected.c.id)} />
                )}
              </aside>
            ) : (
              <div className="self-start rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Selecione um item.</div>
            )}
          </section>
          <p className="shrink-0 text-xs text-muted-foreground">
            Busca feita em {(result.durationMs / 1000).toFixed(1).replace('.', ',')} s. Pastas genéricas como dist e build só
            aparecem quando o .gitignore do projeto as lista.
          </p>
        </>
      )}
    </>
  )
}
