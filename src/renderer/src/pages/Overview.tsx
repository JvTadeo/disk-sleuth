import { useState } from 'react'
import {
  RiAddLine,
  RiApps2Line,
  RiArrowDownLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiDownloadLine,
  RiHardDrive3Line,
  RiPieChart2Line,
  RiRadarLine,
  RiSubtractLine
} from '@remixicon/react'
import type { ScanChange } from '@shared/scan'
import { CategoryBreakdown } from '@/components/CategoryBreakdown'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UsageBar } from '@/components/ui/usage-bar'
import { FolderList } from '@/components/FolderList'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { useChildren } from '@/hooks/use-children'
import { formatBytes, formatDuration, formatInt, formatPercent, formatWhen } from '@/lib/format'
import { driveForRoot, driveLabel, driveShort, useApp, useAttentionCount, useScanKey } from '@/store/app'

function BiggestFolders() {
  const summary = useApp((s) => s.summary)!
  const drives = useApp((s) => s.drives)
  const setPage = useApp((s) => s.setPage)
  const { data } = useChildren(summary.rootId, useScanKey())
  const drive = driveForRoot(drives, summary.root)

  return (
    <Card className="gap-2 pb-3">
      <CardHeader>
        <h2 className="text-[15px] font-semibold">Maiores itens em {drive ? driveShort(drive) : summary.root}</h2>
        <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={() => setPage('disk')}>
          Abrir no Disco
        </Button>
      </CardHeader>
      <CardContent className="px-2.5">
        {data ? (
          <FolderList items={data.children.slice(0, 8)} total={summary.alloc} compact />
        ) : (
          <div className="h-48 animate-pulse rounded-lg bg-muted/40" />
        )}
      </CardContent>
    </Card>
  )
}

function TypesCard() {
  const summary = useApp((s) => s.summary)!
  return (
    <Card className="gap-3">
      <CardHeader>
        <h2 className="text-[15px] font-semibold">Por tipo de arquivo</h2>
        <RiPieChart2Line size={18} className="text-muted-foreground/70" aria-hidden />
      </CardHeader>
      <CardContent>
        <CategoryBreakdown bytes={summary.categories} limit={10} />
      </CardContent>
    </Card>
  )
}

function signedBytes(n: number): string {
  return `${n >= 0 ? '+' : '−'}${formatBytes(Math.abs(n))}`
}

const STATUS_ICON: Record<ScanChange['status'], typeof RiArrowUpLine> = {
  grew: RiArrowUpLine,
  shrank: RiArrowDownLine,
  new: RiAddLine,
  removed: RiSubtractLine
}
const STATUS_LABEL: Record<ScanChange['status'], string> = {
  grew: 'cresceu',
  shrank: 'diminuiu',
  new: 'novo',
  removed: 'removido'
}

function ChangesCard() {
  const diff = useApp((s) => s.summary?.diff)!
  const openInDisk = useApp((s) => s.openInDisk)
  const up = diff.totalDelta >= 0
  return (
    <Card className="gap-2 pb-3">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold">Desde a varredura anterior</h2>
          <span className="text-xs text-muted-foreground">{formatWhen(new Date(diff.previousAt))}</span>
        </div>
        <span className={cn('text-lg font-semibold tabular-nums', up ? 'text-status-warn' : 'text-status-ok')}>
          {signedBytes(diff.totalDelta)}
        </span>
      </CardHeader>
      <CardContent className="px-2.5">
        {diff.changes.length ? (
          <ul className="flex flex-col">
            {diff.changes.slice(0, 8).map((c) => {
              const Icon = STATUS_ICON[c.status]
              const grew = c.delta >= 0
              return (
                <li key={c.path}>
                  <button
                    type="button"
                    disabled={c.id === undefined}
                    onClick={() => c.id !== undefined && openInDisk(c.id)}
                    className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none enabled:hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default"
                  >
                    <Icon
                      size={16}
                      className={cn('shrink-0', grew ? 'text-status-warn' : 'text-status-ok')}
                      aria-label={STATUS_LABEL[c.status]}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">{c.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground" title={c.path}>
                        {c.path}
                      </span>
                    </span>
                    <span className={cn('shrink-0 font-mono text-[13px] tabular-nums', grew ? 'text-status-warn' : 'text-status-ok')}>
                      {signedBytes(c.delta)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-2.5 py-3 text-sm text-muted-foreground">Nenhuma mudança acima de 100 MB.</p>
        )}
      </CardContent>
    </Card>
  )
}

function ProgramsCard() {
  const result = useApp((s) => s.programs)!
  const setPage = useApp((s) => s.setPage)
  const attention = useAttentionCount()
  const visible = result.programs.filter((p) => !p.hidden)
  const count = (st: string) => visible.filter((p) => p.status === st).length
  const line = (color: string, label: string, n: number) => (
    <div className="flex items-center gap-2.5 py-1 text-sm">
      <span className={`size-2 rounded-full ${color}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-semibold tabular-nums">{formatInt(n)}</span>
    </div>
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Programas</CardTitle>
        <RiApps2Line size={18} className="text-muted-foreground/70" aria-hidden />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{formatInt(visible.length)}</span>
          <span className="text-[13px] text-muted-foreground">encontrados</span>
        </div>
        <div>
          {line('bg-status-ok', 'Registrados no Windows', count('reg'))}
          {line('bg-status-warn', 'Não registrados', count('unreg'))}
          {line('bg-status-bad', 'Órfãos', count('orphan'))}
        </div>
        {attention > 0 && (
          <Button variant="link" size="sm" className="h-auto w-fit p-0" onClick={() => setPage('programs')}>
            Revisar {formatInt(attention)} {attention === 1 ? 'item' : 'itens'}
            <RiArrowRightSLine aria-hidden />
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default function Overview() {
  const drives = useApp((s) => s.drives)
  const loaded = useApp((s) => s.drivesLoaded)
  const selected = useApp((s) => s.drives.find((d) => d.letter === s.selectedDrive))
  const summary = useApp((s) => s.summary)
  const status = useApp((s) => s.scanStatus)
  const startScan = useApp((s) => s.startScan)
  const setPage = useApp((s) => s.setPage)
  const programs = useApp((s) => s.programs)
  const exportReport = useApp((s) => s.exportReport)
  const [exportNote, setExportNote] = useState<string | null>(null)

  const onExport = async (): Promise<void> => {
    try {
      const path = await exportReport()
      if (path) setExportNote(`Relatório salvo em ${path}`)
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : String(err))
    }
  }

  const scanned = summary ? driveForRoot(drives, summary.root) : undefined
  const subtitle =
    status === 'scanning'
      ? 'Varredura em andamento…'
      : summary
        ? `Última varredura de ${scanned ? driveShort(scanned) : summary.root} ${formatWhen(new Date(summary.finishedAt))} · ${formatInt(summary.files)} arquivos em ${formatDuration(summary.durationMs)}${summary.fromCache ? ' · resultado salvo' : ''}`
        : 'Nenhuma varredura ainda'

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle={subtitle}
        actions={
          <>
          <Button
            variant="outline"
            disabled={!(summary && !summary.cancelled) && !programs?.supported}
            onClick={() => void onExport()}
          >
            <RiDownloadLine aria-hidden />
            Exportar relatório
          </Button>
          {status === 'scanning' ? (
            <Button variant="outline" onClick={() => setPage('scan')}>
              <RiRadarLine aria-hidden />
              Ver progresso
            </Button>
          ) : (
            <Button disabled={!selected} onClick={() => selected && void startScan(selected.root)}>
              <RiRadarLine aria-hidden />
              {selected && selected.letter !== '/' ? `Escanear ${selected.letter}: agora` : 'Escanear agora'}
            </Button>
          )}
          </>
        }
      />
      {exportNote && <p className="selectable -mt-2 text-xs text-muted-foreground">{exportNote}</p>}

      <section className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
        {!loaded &&
          [0, 1].map((i) => <div key={i} className="h-[150px] animate-pulse rounded-xl border bg-muted/40" />)}
        {drives.map((d) => {
          const used = d.total - d.free
          return (
            <Card key={d.letter}>
              <CardHeader>
                <CardTitle>{driveLabel(d)}</CardTitle>
                <RiHardDrive3Line size={18} className="text-muted-foreground/70" aria-hidden />
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tracking-tight tabular-nums">{formatBytes(used)}</span>
                  <span className="text-[13px] text-muted-foreground">
                    de {formatBytes(d.total)} · {formatPercent(used, d.total)} usado
                  </span>
                </div>
                <UsageBar value={used} max={d.total} className="h-3" label={`Uso de ${driveLabel(d)}`} />
                <span className="text-xs text-muted-foreground">{formatBytes(d.free)} livres</span>
              </CardContent>
            </Card>
          )
        })}
        {programs?.supported && <ProgramsCard />}
      </section>

      {summary ? (
        <>
          <section className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] items-start gap-4">
            {summary.categories && <TypesCard />}
            {summary.diff && <ChangesCard />}
          </section>
          <BiggestFolders />
        </>
      ) : (
        <EmptyState icon={RiRadarLine} title="Escaneie um disco para começar">
          Depois da primeira varredura, esta tela mostra as maiores pastas, os programas encontrados e o que precisa de
          atenção.
        </EmptyState>
      )}
    </>
  )
}
