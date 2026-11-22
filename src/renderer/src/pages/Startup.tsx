import { useEffect, useMemo, useState } from 'react'
import {
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiLock2Line,
  RiRefreshLine,
  RiShieldUserLine,
  RiShutDownLine
} from '@remixicon/react'
import type { StartupItem, StartupSource } from '@shared/startup'
import type { ProgramStatus } from '@shared/programs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { formatInt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { cleanError, useApp } from '@/store/app'

type Filter = 'all' | 'on' | 'off' | 'orphan'

const SOURCE: Record<StartupSource, string> = {
  runUser: 'Registro (usuário)',
  runMachine: 'Registro (todos os usuários)',
  runMachine32: 'Registro (todos, 32 bits)',
  folderUser: 'Pasta Inicializar',
  folderCommon: 'Pasta Inicializar (todos)',
  task: 'Tarefa agendada'
}

const OWNER: Record<ProgramStatus, { label: string; variant: 'ok' | 'warn' | 'bad' }> = {
  reg: { label: 'Registrado', variant: 'ok' },
  unreg: { label: 'Não registrado', variant: 'warn' },
  orphan: { label: 'Órfão', variant: 'bad' }
}

const isOrphan = (i: StartupItem): boolean => i.targetExists === false

function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        on ? 'bg-primary' : 'bg-input dark:bg-input/80'
      )}
    >
      <span
        className={cn(
          'pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform',
          on ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

function Tags({ i }: { i: StartupItem }) {
  return (
    <>
      {isOrphan(i) && <Badge variant="bad">Órfão</Badge>}
      {i.protectedKind === 'microsoft' && <Badge variant="secondary">Do sistema</Badge>}
      {i.protectedKind === 'security' && <Badge variant="secondary">Segurança</Badge>}
    </>
  )
}

function warningFor(i: StartupItem, isAdmin: boolean): { text: string; tone: 'bad' | 'warn' | 'muted' } | null {
  if (isOrphan(i)) {
    return {
      text: 'O arquivo que esta entrada abre não existe mais: sobrou de um programa desinstalado. Remover a entrada não afeta nada.',
      tone: 'bad'
    }
  }
  if (i.protectedKind === 'security') {
    return { text: 'Programa de segurança. Desativar pode deixar o PC sem proteção até a próxima vez que você abri-lo.', tone: 'warn' }
  }
  if (i.protectedKind === 'microsoft') {
    return {
      text: 'Item da Microsoft. Desativar é seguro e reversível, mas algum recurso do Windows pode deixar de aparecer até você reativar.',
      tone: 'warn'
    }
  }
  if (i.needsAdmin && !isAdmin) {
    return { text: 'Vale para todos os usuários do PC, então ativar ou desativar pede o modo administrador.', tone: 'muted' }
  }
  return null
}

function Details({
  i,
  isAdmin,
  busy,
  onToggle,
  onRemove,
  onShow
}: {
  i: StartupItem
  isAdmin: boolean
  busy: boolean
  onToggle: () => void
  onRemove: () => void
  onShow: () => void
}) {
  const setPage = useApp((s) => s.setPage)
  const warning = warningFor(i, isAdmin)
  const locked = i.needsAdmin && !isAdmin
  return (
    <aside aria-label="Detalhes" className="flex max-h-full flex-col gap-4 self-start overflow-y-auto rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={i.enabled ? 'ok' : 'secondary'}>{i.enabled ? 'Ativado' : 'Desativado'}</Badge>
          {i.needsAdmin && <Badge variant="outline">Pede administrador</Badge>}
          <Tags i={i} />
        </div>
        <h2 className="text-lg font-semibold leading-snug">{i.name}</h2>
        <span className="text-[13px] text-muted-foreground">
          {i.publisher ?? 'Fabricante desconhecido'}
        </span>
      </div>
      {warning && (
        <p
          className={cn(
            'rounded-md px-3 py-2 text-xs leading-relaxed',
            warning.tone === 'bad' ? 'bg-status-bad/10 text-status-bad' : warning.tone === 'warn' ? 'bg-status-warn/10 text-status-warn' : 'bg-muted text-muted-foreground'
          )}
        >
          {warning.text}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Comando</h3>
        <code className="selectable block break-all rounded-md bg-muted px-2.5 py-2 font-mono text-xs">{i.command}</code>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Onde o Windows guarda</h3>
        <span className="text-[13px]">{SOURCE[i.source]}</span>
        <code className="selectable block break-all rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] text-muted-foreground">{i.location}</code>
      </div>
      {i.owner && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Pertence a</h3>
          <button
            type="button"
            onClick={() => setPage('programs')}
            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="truncate text-sm font-medium">{i.owner.name}</span>
            <Badge variant={OWNER[i.owner.status].variant}>{OWNER[i.owner.status].label}</Badge>
          </button>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted-foreground">Estado</dt>
          <dd className="text-sm font-semibold">
            {i.enabled ? 'Abre com o Windows' : i.disabledAt ? `Desativado em ${new Date(i.disabledAt).toLocaleDateString('pt-BR')}` : 'Desativado'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Arquivo</dt>
          <dd className="text-sm font-semibold">{i.targetExists === false ? 'Não existe' : i.targetExists ? 'Encontrado' : 'Desconhecido'}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        {isOrphan(i) ? (
          <Button size="sm" variant="destructive" disabled={busy || locked} onClick={onRemove}>
            <RiDeleteBinLine aria-hidden />
            Remover entrada
          </Button>
        ) : (
          <Button size="sm" variant={i.enabled ? 'default' : 'outline'} disabled={busy || locked} onClick={onToggle}>
            {locked && <RiLock2Line aria-hidden />}
            {i.enabled ? 'Desativar' : 'Ativar'}
          </Button>
        )}
        {(i.targetExists || i.source === 'folderUser' || i.source === 'folderCommon') && (
          <Button size="sm" variant="outline" onClick={onShow}>
            <RiExternalLinkLine aria-hidden />
            Abrir local do arquivo
          </Button>
        )}
      </div>
    </aside>
  )
}

export default function Startup() {
  const result = useApp((s) => s.startup)
  const loading = useApp((s) => s.startupLoading)
  const error = useApp((s) => s.startupError)
  const load = useApp((s) => s.loadStartup)
  const setResult = useApp((s) => s.setStartup)
  const relaunchAsAdmin = useApp((s) => s.relaunchAsAdmin)

  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!result && !loading) void load()
  }, [result, loading, load])

  const items = useMemo(() => result?.items ?? [], [result])
  const counts = useMemo(
    () => ({
      all: items.length,
      on: items.filter((i) => i.enabled).length,
      off: items.filter((i) => !i.enabled).length,
      orphan: items.filter(isOrphan).length
    }),
    [items]
  )
  const rows = useMemo(
    () =>
      items
        .filter((i) => (filter === 'on' ? i.enabled : filter === 'off' ? !i.enabled : filter === 'orphan' ? isOrphan(i) : true))
        .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, 'pt-BR')),
    [items, filter]
  )
  const selected = rows.find((i) => i.id === selectedId) ?? rows[0]
  const isAdmin = result?.isAdmin ?? false
  const lockedCount = items.filter((i) => i.needsAdmin).length

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
    } catch (err) {
      setActionError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }
  const toggle = (i: StartupItem): Promise<void> => act(async () => setResult(await window.api.startup.setEnabled(i.id, !i.enabled)))
  const remove = (i: StartupItem): Promise<void> =>
    act(async () => {
      const r = await window.api.startup.remove(i.id)
      if (r) setResult(r)
    })
  const show = (i: StartupItem): Promise<void> => act(() => window.api.startup.showFile(i.id))

  if (result && !result.supported) {
    return (
      <>
        <PageHeader title="Inicialização" />
        <EmptyState icon={RiShutDownLine} title="Disponível apenas no Windows">
          A lista vem do registro do Windows, das pastas Inicializar e do Agendador de Tarefas.
        </EmptyState>
      </>
    )
  }

  const tabs: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'on', label: 'Ativados' },
    { id: 'off', label: 'Desativados' },
    { id: 'orphan', label: 'Órfãos' }
  ]
  const grid = 'grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]'

  return (
    <>
      <PageHeader
        title="Inicialização"
        subtitle={
          result
            ? `${formatInt(counts.all)} itens abrem com o Windows · ${formatInt(counts.on)} ativados`
            : 'Lendo o registro, as pastas Inicializar e o Agendador de Tarefas…'
        }
        actions={
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
            {loading ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiRefreshLine aria-hidden />}
            {loading ? 'Lendo…' : 'Atualizar lista'}
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
      {result?.warnings.map((w) => (
        <p key={w} className="selectable rounded-md bg-status-warn/10 px-3 py-2 text-xs text-status-warn">
          {w}
        </p>
      ))}

      {!result ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
          <RiLoader4Line size={28} className="animate-spin text-muted-foreground" aria-hidden />
          <p className="max-w-md text-sm text-muted-foreground">
            Lendo as chaves Run do registro, as pastas Inicializar e as tarefas que rodam ao entrar no Windows. Leva alguns segundos.
          </p>
        </div>
      ) : (
        <>
          {!isAdmin && lockedCount > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
              <RiLock2Line size={18} aria-hidden />
              <span className="flex-1">
                {formatInt(lockedCount)} {lockedCount === 1 ? 'item vale' : 'itens valem'} para todos os usuários do PC e só
                {lockedCount === 1 ? ' pode' : ' podem'} ser mudados no modo administrador.
              </span>
              <Button size="sm" variant="outline" onClick={() => void relaunchAsAdmin()}>
                <RiShieldUserLine aria-hidden />
                Reabrir como administrador
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Filtrar" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-[3px]">
              {tabs.map((t) => (
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
            <span className="text-xs text-muted-foreground">Desativar não apaga nada: dá para reativar aqui ou no Gerenciador de Tarefas</span>
          </div>

          <section className="grid min-h-80 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,360px)] grid-rows-[minmax(0,1fr)] gap-4">
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
              <div className="grid shrink-0 grid-cols-[64px_minmax(0,1fr)] border-b bg-muted/40 text-xs font-medium text-muted-foreground">
                <span className="py-2.5 pl-4">Ativo</span>
                <div className={cn('grid gap-4 py-2.5 pr-4', grid)}>
                  <span>Programa</span>
                  <span>Origem</span>
                </div>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {rows.map((i) => {
                  const isSel = i.id === selected?.id
                  return (
                    <li
                      key={i.id}
                      className={cn('grid grid-cols-[64px_minmax(0,1fr)] border-b border-border/50', isSel ? 'bg-accent' : 'hover:bg-accent/50')}
                    >
                      <span className="flex items-center pl-4">
                        <Switch
                          on={i.enabled}
                          disabled={busy || (i.needsAdmin && !isAdmin)}
                          label={`${i.enabled ? 'Desativar' : 'Ativar'} ${i.name}`}
                          onChange={() => void toggle(i)}
                        />
                      </span>
                      <button
                        type="button"
                        aria-pressed={isSel}
                        onClick={() => setSelectedId(i.id)}
                        className={cn('grid min-w-0 items-center gap-4 py-2.5 pr-4 text-left outline-none focus-visible:bg-accent', grid)}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className={cn('truncate text-sm font-medium', !i.enabled && 'text-muted-foreground')}>{i.name}</span>
                            <Tags i={i} />
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{i.publisher ?? '—'}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                          {i.needsAdmin && !isAdmin && <RiLock2Line size={14} className="shrink-0" aria-label="Pede administrador" />}
                          <span className="truncate">{SOURCE[i.source]}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
                {!rows.length && <li className="px-4 py-12 text-center text-sm text-muted-foreground">Nenhum item com esse filtro.</li>}
              </ul>
              <div className="shrink-0 border-t px-4 py-2.5 text-xs text-muted-foreground">
                Lido em {(result.durationMs / 1000).toFixed(1).replace('.', ',')} s · ordenado por estado e nome
              </div>
            </div>
            {selected ? (
              <Details
                i={selected}
                isAdmin={isAdmin}
                busy={busy}
                onToggle={() => void toggle(selected)}
                onRemove={() => void remove(selected)}
                onShow={() => void show(selected)}
              />
            ) : (
              <div className="self-start rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Selecione um item.</div>
            )}
          </section>
        </>
      )}
    </>
  )
}
