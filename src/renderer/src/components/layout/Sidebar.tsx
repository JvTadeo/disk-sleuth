import {
  type RemixiconComponentType,
  RiApps2Line,
  RiDashboardLine,
  RiFolder3Line,
  RiHardDrive3Line,
  RiSettings3Line,
  RiShieldCheckLine,
  RiShieldUserLine
} from '@remixicon/react'
import { UsageBar } from '@/components/ui/usage-bar'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { driveLabel, useApp, useAttentionCount, type Page } from '@/store/app'

type Icon = RemixiconComponentType

const NAV: { page: Page; label: string; icon: Icon }[] = [
  { page: 'overview', label: 'Visão geral', icon: RiDashboardLine },
  { page: 'disk', label: 'Disco', icon: RiFolder3Line },
  { page: 'programs', label: 'Programas', icon: RiApps2Line }
]

function NavItem({ page, label, icon: Icon, badge }: { page: Page; label: string; icon: Icon; badge?: number }) {
  const active = useApp((s) => s.page === page)
  const setPage = useApp((s) => s.setPage)
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => setPage(page)}
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <Icon size={18} aria-hidden />
      {label}
      {!!badge && (
        <span
          className="ml-auto rounded-full bg-status-warn/15 px-2 py-px text-xs font-medium text-status-warn tabular-nums"
          aria-label={`${badge} precisam de atenção`}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

function Drives() {
  const drives = useApp((s) => s.drives)
  const loaded = useApp((s) => s.drivesLoaded)
  const selected = useApp((s) => s.selectedDrive)
  const selectDrive = useApp((s) => s.selectDrive)

  if (!loaded) {
    return <div className="h-[76px] animate-pulse rounded-lg bg-accent" aria-label="Carregando unidades" />
  }
  if (!drives.length) {
    return <p className="px-1 text-xs text-muted-foreground">Nenhuma unidade encontrada.</p>
  }
  return (
    <>
      {drives.map((d) => {
        const used = d.total - d.free
        const active = d.letter === selected
        return (
          <button
            key={d.letter}
            type="button"
            aria-pressed={active}
            onClick={() => selectDrive(d.letter)}
            className={cn(
              'flex w-full flex-col gap-2 rounded-lg border bg-background p-2.5 px-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active ? 'border-primary' : 'hover:bg-accent/40'
            )}
          >
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <RiHardDrive3Line size={16} aria-hidden />
              {driveLabel(d)}
            </span>
            <UsageBar
              value={used}
              max={d.total}
              label={`Uso de ${driveLabel(d)}`}
              barClassName={active ? 'bg-primary' : 'bg-muted-foreground/50'}
            />
            <span className="text-xs text-muted-foreground">
              {formatBytes(d.free)} livres de {formatBytes(d.total)}
            </span>
          </button>
        )
      })}
    </>
  )
}

/** "Scan as administrator" while unelevated; a quiet badge once elevated. */
function AdminEntry() {
  const isAdmin = useApp((s) => s.isAdmin)
  const root = useApp((s) => s.drives.find((d) => d.letter === s.selectedDrive)?.root)
  const relaunch = useApp((s) => s.relaunchAsAdmin)
  if (isAdmin) {
    return (
      <div className="flex h-9 items-center gap-2.5 px-2.5 text-sm text-status-ok">
        <RiShieldCheckLine size={18} aria-hidden />
        Modo administrador
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void relaunch(root)}
      title="Reabre o app com permissão de administrador e escaneia a unidade selecionada, incluindo pastas protegidas"
      className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <RiShieldUserLine size={18} aria-hidden />
      Escanear como admin
    </button>
  )
}

export function Sidebar() {
  const attention = useAttentionCount()
  return (
    <nav
      aria-label="Navegação principal"
      className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4"
    >
      <div className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <NavItem key={n.page} {...n} badge={n.page === 'programs' ? attention : undefined} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <div className="px-1 text-xs font-medium text-muted-foreground">Unidades</div>
        <Drives />
      </div>
      <div className="mt-auto flex flex-col gap-0.5">
        <AdminEntry />
        <NavItem page="settings" label="Configurações" icon={RiSettings3Line} />
      </div>
    </nav>
  )
}
