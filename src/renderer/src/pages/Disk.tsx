import { useCallback, useEffect, useMemo, useState } from 'react'
import { RiArrowRightSLine, RiArrowUpLine, RiFolder3Line, RiRadarLine } from '@remixicon/react'
import type { RemoveMode } from '@shared/ipc'
import type { NodeInfo, ScanNode } from '@shared/scan'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FolderTree } from '@/components/FolderTree'
import { ItemDetails } from '@/components/ItemDetails'
import { LargestFiles } from '@/components/LargestFiles'
import { Treemap } from '@/components/Treemap'
import { Duplicates } from '@/components/Duplicates'
import { CATEGORY_INFO, categoryChartColor, rankCategories } from '@/lib/categories'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { useNodeInfo, useTreemap } from '@/hooks/use-children'
import { formatBytes, formatInt, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { driveForRoot, driveLabel, driveShort, useApp, useScanKey } from '@/store/app'

type Tab = 'folders' | 'files' | 'dups'

const TABS: { id: Tab; label: string }[] = [
  { id: 'folders', label: 'Pastas' },
  { id: 'files', label: 'Maiores arquivos' },
  { id: 'dups', label: 'Duplicados' }
]

const cleanError = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)

function NoScan() {
  const selected = useApp((s) => s.drives.find((d) => d.letter === s.selectedDrive))
  const startScan = useApp((s) => s.startScan)
  const status = useApp((s) => s.scanStatus)
  const scanRoot = useApp((s) => s.scanRoot)
  const drives = useApp((s) => s.drives)
  const setPage = useApp((s) => s.setPage)
  const busy = status === 'scanning'
  const scanningThis = busy && !!selected && scanRoot?.toLowerCase() === selected.root.toLowerCase()
  const other = busy ? driveForRoot(drives, scanRoot) : undefined

  return (
    <>
      <PageHeader title={selected ? driveLabel(selected) : 'Disco'} />
      <EmptyState
        icon={scanningThis ? RiRadarLine : RiFolder3Line}
        title={scanningThis ? 'Varredura em andamento' : 'Nenhuma varredura desta unidade ainda'}
        action={
          scanningThis ? (
            <Button variant="outline" onClick={() => setPage('scan')}>
              Ver progresso
            </Button>
          ) : (
            selected && (
              <Button disabled={busy} onClick={() => void startScan(selected.root)}>
                <RiRadarLine aria-hidden />
                Escanear {driveLabel(selected)}
              </Button>
            )
          )
        }
      >
        {scanningThis
          ? 'O resultado aparece aqui quando a varredura terminar.'
          : busy
            ? `Aguarde a varredura de ${other ? driveLabel(other) : (scanRoot ?? '')} terminar para escanear esta unidade.`
            : 'Escaneie a unidade para ver o que ocupa espaço, pasta por pasta.'}
      </EmptyState>
    </>
  )
}

export default function Disk() {
  const summary = useApp((s) => s.summary)
  const selected = useApp((s) => s.drives.find((d) => d.letter === s.selectedDrive))
  // Show the browser only for the scan of the drive picked in the sidebar.
  const matches = !!summary && (!selected || summary.root.toLowerCase() === selected.root.toLowerCase())
  if (!summary || !matches) return <NoScan />
  return <DiskBrowser />
}

function DiskBrowser() {
  const summary = useApp((s) => s.summary)!
  const drives = useApp((s) => s.drives)
  const dark = useApp((s) => s.theme.dark)
  const colorMode = useApp((s) => s.colorMode)
  const setColorMode = useApp((s) => s.setColorMode)
  const startScan = useApp((s) => s.startScan)
  const applyRemoval = useApp((s) => s.applyRemoval)
  const key = useScanKey()

  const [tab, setTab] = useState<Tab>('folders')
  const [currentId, setCurrentId] = useState(summary.rootId)
  const [selectedId, setSelectedId] = useState<number | null>(summary.rootId)

  // A new scan starts over at its root.
  useEffect(() => {
    setCurrentId(summary.rootId)
    setSelectedId(summary.rootId)
  }, [summary.rootId, summary.finishedAt])

  const { data: treemap } = useTreemap(currentId, key)
  const { data: current } = useNodeInfo(currentId, key)
  const { data: selected } = useNodeInfo(selectedId, key)

  const drive = driveForRoot(drives, summary.root)
  const trail = useMemo(() => current?.trail ?? [], [current])
  const expandTo = useMemo(() => trail.map((t) => t.id), [trail])
  const upId = trail.length > 1 ? trail[trail.length - 2].id : null

  const navigate = useCallback((id: number) => {
    setCurrentId(id)
    setSelectedId(id)
  }, [])

  const goUp = useCallback(() => {
    if (upId !== null) navigate(upId)
  }, [upId, navigate])

  // Backspace goes up a level, like in Explorer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (e.key === 'Backspace' && !(t instanceof HTMLInputElement) && !t.isContentEditable) {
        e.preventDefault()
        goUp()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goUp])

  const onTreeSelect = (node: ScanNode): void => {
    setSelectedId(node.id)
    if (node.kind === 'dir' && node.files > 0) setCurrentId(node.id)
  }

  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => setNote(null), [selectedId])

  const removeItem = useCallback(
    async (info: NodeInfo, mode: RemoveMode): Promise<void> => {
      if (info.trail.length <= 1 || busy) return
      setBusy(true)
      setNote(null)
      try {
        const r = await window.api.item.remove(info.node.id, mode)
        if (!r.trashed) return
        const parent = info.trail.length > 1 ? info.trail[info.trail.length - 2].id : summary.rootId
        // If the removed item was the folder on screen (or contained it), step out to its parent.
        if (trail.some((t) => t.id === info.node.id)) setCurrentId(parent)
        setSelectedId(parent)
        applyRemoval(r.root)
      } catch (err) {
        setNote(cleanError(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, summary.rootId, trail, applyRemoval]
  )

  const remove = useCallback(
    async (mode: RemoveMode): Promise<void> => {
      if (selected) await removeItem(selected, mode)
    },
    [selected, removeItem]
  )

  /** Right-click anywhere (tree, treemap, lists): native menu, then act on the choice here. */
  const openMenu = useCallback(
    async (nodeId: number): Promise<void> => {
      setSelectedId(nodeId)
      try {
        const action = await window.api.item.contextMenu(nodeId)
        if (!action) return
        if (action === 'explorer') return void window.api.item.showInFolder(nodeId)
        if (action === 'copy') return void window.api.item.copyPath(nodeId)
        if (action === 'enter') return navigate(nodeId)
        if (action === 'empty') {
          setBusy(true)
          try {
            const r = await window.api.item.empty(nodeId)
            if (!r.emptied) return
            applyRemoval(r.root)
            if (r.failed)
              setNote(
                `${formatInt(r.failed)} ${r.failed === 1 ? 'item não pôde ser removido' : 'itens não puderam ser removidos'} (em uso ou protegidos). Escaneie de novo para atualizar os tamanhos.`
              )
          } finally {
            setBusy(false)
          }
          return
        }
        const info = await window.api.scan.info(nodeId)
        if (info) await removeItem(info, action === 'delete' ? 'delete' : 'trash')
      } catch (err) {
        setNote(cleanError(err))
      }
    },
    [navigate, removeItem, applyRemoval]
  )

  // Coming from an Overview link: reveal that node (its folder on screen, the node selected).
  const diskFocus = useApp((s) => s.diskFocus)
  const clearDiskFocus = useApp((s) => s.clearDiskFocus)
  useEffect(() => {
    if (diskFocus === null) return
    clearDiskFocus()
    void window.api.scan.info(diskFocus).then((info) => {
      if (!info) return
      const isDir = info.node.kind === 'dir' && info.node.files > 0
      const parent = info.trail.length > 1 ? info.trail[info.trail.length - 2].id : summary.rootId
      setTab('folders')
      setCurrentId(isDir ? info.node.id : parent)
      setSelectedId(info.node.id)
    })
  }, [diskFocus, clearDiskFocus, summary.rootId])

  // Explorer shortcuts: Delete → Recycle Bin, Shift+Delete → permanently.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (e.key !== 'Delete' || t instanceof HTMLInputElement || t.isContentEditable) return
      e.preventDefault()
      void remove(e.shiftKey ? 'delete' : 'trash')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [remove])

  const title = current ? (trail.length === 1 && drive ? driveLabel(drive) : current.node.name) : '…'

  return (
    <>
      <div className="flex flex-col gap-2">
        <nav aria-label="Caminho" className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
          {trail.map((t, i) => {
            const last = i === trail.length - 1
            const label = i === 0 && drive ? driveShort(drive) : t.name
            return (
              <span key={t.id} className="inline-flex items-center gap-1">
                {i > 0 && <RiArrowRightSLine size={14} aria-hidden />}
                {last ? (
                  <span aria-current="page" className="font-medium text-foreground">
                    {label}
                  </span>
                ) : (
                  <button type="button" className="hover:text-foreground" onClick={() => navigate(t.id)}>
                    {label}
                  </button>
                )}
              </span>
            )
          })}
        </nav>
        <PageHeader
          title={title}
          subtitle={
            current &&
            `${formatBytes(current.node.alloc)} em ${formatInt(current.node.files)} arquivos · ${formatPercent(current.node.alloc, summary.alloc)} do total escaneado`
          }
          actions={
            <>
              <Button variant="outline" disabled={upId === null} onClick={goUp} title="Subir (Backspace)">
                <RiArrowUpLine aria-hidden />
                Subir
              </Button>
              <Button variant="outline" onClick={() => void startScan(summary.root)}>
                <RiRadarLine aria-hidden />
                Escanear de novo
              </Button>
            </>
          }
        />
      </div>

      <div role="tablist" aria-label="Visualização" className="inline-flex w-fit gap-0.5 rounded-lg bg-muted p-[3px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'h-7.5 rounded-md px-3 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              tab === t.id ? 'bg-background text-foreground shadow-xs dark:bg-input/40' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'folders' ? (
        <section key="folders" className="page-enter grid h-[max(380px,calc(100vh-430px))] grid-cols-[minmax(260px,1fr)_minmax(0,2fr)] gap-4">
          <Card className="h-full min-h-0 gap-0 p-1">
            <FolderTree
              rootId={summary.rootId}
              dataKey={key ?? ''}
              currentId={currentId}
              selectedId={selectedId}
              expandTo={expandTo}
              onSelect={onTreeSelect}
              onMenu={(n) => void openMenu(n.id)}
            />
          </Card>
          <Card className="h-full min-h-0 gap-2 p-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
              {colorMode === 'type' ? (
                <div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {(current?.categories ? rankCategories(current.categories) : []).slice(0, 7).map((c) => (
                    <span key={c.key} className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: categoryChartColor(c.index) }} />
                      {CATEGORY_INFO[c.key].label}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="flex-1 text-[11px] text-muted-foreground">Cores por pasta</span>
              )}
              <div role="radiogroup" aria-label="Colorir o mapa por" className="ml-auto inline-flex gap-0.5 rounded-md bg-muted p-0.5">
                {(
                  [
                    ['folder', 'Pasta'],
                    ['type', 'Tipo de arquivo']
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={colorMode === mode}
                    onClick={() => setColorMode(mode)}
                    className={cn(
                      'h-6 rounded px-2 text-[11px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      colorMode === mode ? 'bg-background text-foreground shadow-xs dark:bg-input/40' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Treemap
                data={treemap}
                dark={dark}
                colorMode={colorMode}
                selectedId={selectedId}
                onSelect={(n) => setSelectedId(n.id)}
                onOpen={(n) => navigate(n.id)}
                onMenu={(n) => void openMenu(n.id)}
                label={`Mapa de ocupação de ${title}`}
              />
            </div>
          </Card>
        </section>
      ) : tab === 'files' ? (
        <Card key="files" className="page-enter h-[max(380px,calc(100vh-430px))] gap-0 p-1.5">
          <LargestFiles
            dataKey={key ?? ''}
            selectedId={selectedId}
            onSelect={(i) => setSelectedId(i.node.id)}
            onMenu={(i) => void openMenu(i.node.id)}
          />
        </Card>
      ) : (
        <Card key="dups" className="page-enter h-[max(380px,calc(100vh-430px))] gap-0 p-3">
          <Duplicates dataKey={key ?? ''} selectedId={selectedId} onSelect={setSelectedId} onMenu={(id) => void openMenu(id)} />
        </Card>
      )}

      <ItemDetails
        info={selected}
        total={summary.alloc}
        onEnter={navigate}
        onRemove={(mode) => void remove(mode)}
        busy={busy}
        note={note}
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        Clique para ver detalhes · clique direito para mais opções · duplo clique no mapa para entrar · Backspace sobe ·
        Delete manda para a Lixeira · Shift+Delete exclui de vez
      </p>
    </>
  )
}
