import { useEffect, useState } from 'react'
import type { AppInfo, CacheInfo, ThemeSource } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { formatBytes, formatWhen } from '@/lib/format'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

const OPTIONS: { value: ThemeSource; label: string; hint: string }[] = [
  { value: 'light', label: 'Claro', hint: 'Sempre claro' },
  { value: 'dark', label: 'Escuro', hint: 'Sempre escuro' },
  { value: 'system', label: 'Padrão do Windows', hint: 'Segue o tema do sistema' }
]

/** Window thumbnail for each theme. */
function Preview({ variant }: { variant: ThemeSource }) {
  const pane = (dark: boolean) => (
    <div className={cn('flex h-full flex-1 gap-1.5 p-1.5', dark ? 'bg-zinc-900' : 'bg-white')}>
      <div className={cn('w-1/4 rounded-sm', dark ? 'bg-zinc-800' : 'bg-zinc-100')} />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className={cn('h-2 w-2/3 rounded-sm', dark ? 'bg-zinc-600' : 'bg-zinc-300')} />
        <div className={cn('flex-1 rounded-sm border', dark ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-zinc-50')} />
      </div>
    </div>
  )
  return (
    <div className="flex h-20 overflow-hidden rounded-md border" aria-hidden>
      {variant === 'light' && pane(false)}
      {variant === 'dark' && pane(true)}
      {variant === 'system' && (
        <>
          {pane(false)}
          {pane(true)}
        </>
      )}
    </div>
  )
}

function ThemePicker() {
  const source = useApp((s) => s.theme.source)
  const dark = useApp((s) => s.theme.dark)
  const setTheme = useApp((s) => s.setTheme)

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm font-semibold">Tema</legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        {OPTIONS.map((o) => {
          const checked = source === o.value
          return (
            <label
              key={o.value}
              className={cn(
                'flex cursor-pointer flex-col gap-2.5 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                checked ? 'border-brand ring-1 ring-brand' : 'hover:bg-accent/40'
              )}
            >
              <input
                type="radio"
                name="theme"
                value={o.value}
                checked={checked}
                onChange={() => void setTheme(o.value)}
                className="sr-only"
              />
              <Preview variant={o.value} />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          )
        })}
      </div>
      {source === 'system' && (
        <p className="text-xs text-muted-foreground">O Windows está usando o tema {dark ? 'escuro' : 'claro'} agora.</p>
      )}
    </fieldset>
  )
}

function About() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.api.app.info().then(setInfo)
  }, [])

  const rows: [string, string][] = info
    ? [
        ['Versão', info.version],
        ['Electron', info.electron],
        ['Chromium', info.chrome],
        ['Tempo de abertura', info.startupMs === null ? 'medindo…' : `${info.startupMs} ms (meta: < 1.500 ms)`],
        ['Permissão', info.isAdmin ? 'Administrador' : 'Usuário comum']
      ]
    : []

  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="selectable text-sm font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function SavedScans() {
  const [list, setList] = useState<CacheInfo[] | null>(null)
  const load = (): void => void window.api.cache.info().then(setList)
  useEffect(load, [])

  if (!list) return <div className="h-10 animate-pulse rounded-md bg-muted/40" />
  if (!list.length) {
    return <p className="text-sm text-muted-foreground">Nenhuma varredura salva. Cada varredura completa fica salva por unidade.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Cada unidade guarda a última varredura completa. Ela aparece ao selecionar a unidade, sem escanear de novo.
      </p>
      <ul className="flex flex-col divide-y rounded-lg border">
        {list.map((c) => (
          <li key={c.root} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
            <span className="font-medium">{c.root}</span>
            <span className="text-muted-foreground">
              salva {formatWhen(new Date(c.savedAt))} · {formatBytes(c.bytes)}
            </span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void window.api.cache.clear(c.root).then(load)}>
              Apagar
            </Button>
          </li>
        ))}
      </ul>
      {list.length > 1 && (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => void window.api.cache.clear().then(load)}>
          Apagar todas
        </Button>
      )}
    </div>
  )
}

export default function Settings() {
  return (
    <>
      <PageHeader title="Configurações" />
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">Aparência</h2>
        </CardHeader>
        <CardContent>
          <ThemePicker />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">Varreduras salvas</h2>
        </CardHeader>
        <CardContent>
          <SavedScans />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">Sobre</h2>
        </CardHeader>
        <CardContent>
          <About />
        </CardContent>
      </Card>
    </>
  )
}
