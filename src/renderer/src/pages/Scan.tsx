import {
  RiErrorWarningLine,
  RiFolder3Line,
  RiFolderOpenLine,
  RiRefreshLine,
  RiShieldUserLine,
  RiStopLine,
  RiTimeLine
} from '@remixicon/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { UsageBar } from '@/components/ui/usage-bar'
import { PageHeader } from '@/components/layout/PageHeader'
import { formatBytes, formatDuration, formatInt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { driveForRoot, driveLabel, useApp } from '@/store/app'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

export default function Scan() {
  const status = useApp((s) => s.scanStatus)
  const root = useApp((s) => s.scanRoot)
  const progress = useApp((s) => s.progress)
  const summary = useApp((s) => s.summary)
  const error = useApp((s) => s.scanError)
  const drives = useApp((s) => s.drives)
  const cancelScan = useApp((s) => s.cancelScan)
  const startScan = useApp((s) => s.startScan)
  const setPage = useApp((s) => s.setPage)
  const isAdmin = useApp((s) => s.isAdmin)
  const relaunch = useApp((s) => s.relaunchAsAdmin)

  const drive = driveForRoot(drives, root)
  const name = drive ? driveLabel(drive) : (root ?? '')
  const scanning = status === 'scanning'

  const files = summary?.files ?? progress?.files ?? 0
  const dirs = summary?.dirs ?? progress?.dirs ?? 0
  const bytes = summary?.alloc ?? progress?.bytes ?? 0
  const elapsed = summary?.durationMs ?? progress?.elapsedMs ?? 0
  const inaccessible = summary?.inaccessible ?? progress?.inaccessible ?? 0
  const speed = elapsed ? (files / elapsed) * 1000 : 0

  // Percent is an estimate: bytes found so far against the drive's used space.
  // Only known when scanning a whole drive; capped at 99% until the scan really ends.
  const used = drive ? drive.total - drive.free : 0
  const pct =
    status === 'done' ? 100 : used ? Math.min(99, Math.floor((bytes / used) * 100)) : null

  const title =
    status === 'done'
      ? 'Varredura concluída'
      : status === 'cancelled'
        ? 'Varredura cancelada'
        : status === 'error'
          ? 'A varredura falhou'
          : `Escaneando ${name}`

  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          summary
            ? `${name} · ${formatInt(summary.files)} arquivos em ${formatDuration(summary.durationMs)}`
            : `${name} · você pode continuar usando o computador`
        }
        actions={
          scanning ? (
            <Button key="cancel" variant="outline" className="text-destructive" onClick={() => void cancelScan()}>
              <RiStopLine aria-hidden />
              Cancelar
            </Button>
          ) : (
            <>
              {root && (
                <Button key="rescan" variant="outline" onClick={() => void startScan(root)}>
                  <RiRefreshLine aria-hidden />
                  Escanear de novo
                </Button>
              )}
              {summary && (
                <Button onClick={() => setPage('disk')}>
                  <RiFolderOpenLine aria-hidden />
                  Ver resultado
                </Button>
              )}
            </>
          )
        }
      />

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 text-sm">
            <RiErrorWarningLine size={20} className="text-destructive" aria-hidden />
            <span className="selectable">{error}</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">
                {pct !== null ? `${pct}%` : formatBytes(bytes)}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {used ? `${formatBytes(bytes)} de ${formatBytes(used)} usados` : 'encontrados até agora'}
              </span>
            </div>
          </div>
          {pct !== null ? (
            <UsageBar
              value={pct}
              max={100}
              className="h-2.5"
              label="Progresso da varredura"
              barClassName={cn(status === 'done' && 'bg-status-ok')}
            />
          ) : (
            <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={cn('h-full w-1/3 rounded-full bg-brand', scanning && 'animate-pulse')} />
            </div>
          )}
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
            <Stat label="Arquivos lidos" value={formatInt(files)} />
            <Stat label="Pastas" value={formatInt(dirs)} />
            <Stat label="Velocidade" value={`${formatInt(speed)} arq/s`} />
            <Stat label="Tempo" value={formatDuration(elapsed)} />
          </dl>
          {scanning && progress && (
            <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-3 py-2.5">
              <RiFolder3Line size={16} className="shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate font-mono text-xs text-muted-foreground">{progress.currentPath}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
        {inaccessible > 0 && (
          <Card className="border-status-warn/40 bg-status-warn/5">
            <CardContent className="flex items-start gap-3">
              <RiErrorWarningLine size={20} className="shrink-0 text-status-warn" aria-hidden />
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-semibold">
                  {formatInt(inaccessible)} {inaccessible === 1 ? 'pasta sem permissão foi pulada' : 'pastas sem permissão foram puladas'}
                </span>
                <span className="text-[13px] leading-relaxed text-muted-foreground">
                  O tamanho delas não entra no total.
                  {!isAdmin && ' Escaneie como administrador para incluí-las.'}
                </span>
                {summary?.inaccessibleSample.slice(0, 3).map((p) => (
                  <span key={p} className="selectable truncate font-mono text-xs text-muted-foreground">
                    {p}
                  </span>
                ))}
                {!isAdmin && !scanning && root && (
                  <Button size="sm" variant="outline" className="mt-1 w-fit" onClick={() => void relaunch(root)}>
                    <RiShieldUserLine aria-hidden />
                    Escanear como administrador
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="flex items-start gap-3">
            <RiTimeLine size={20} className="shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Roda em segundo plano</span>
              <span className="text-[13px] leading-relaxed text-muted-foreground">
                A varredura roda em um processo separado. Atalhos de pasta (junctions) não são seguidos e arquivos com
                hardlink contam uma vez só
                {summary ? ` (${formatInt(summary.hardlinksSkipped)} links ignorados nesta varredura)` : ''}.
              </span>
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  )
}
