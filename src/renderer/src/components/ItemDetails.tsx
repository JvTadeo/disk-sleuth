import { useEffect, useState } from 'react'
import {
  RiCheckLine,
  RiDeleteBin2Line,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiFileLine,
  RiFolderOpenLine
} from '@remixicon/react'
import type { RemoveMode } from '@shared/ipc'
import type { NodeInfo } from '@shared/scan'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatBytes, formatInt, formatPercent } from '@/lib/format'
import { CategoryBreakdown } from '@/components/CategoryBreakdown'

interface ItemDetailsProps {
  info: NodeInfo | null
  /** Size of the scanned root, for the "share of total" figure. */
  total: number
  onEnter: (id: number) => void
  /** Removes the item (the parent owns the confirmation flow and the keyboard shortcuts). */
  onRemove: (mode: RemoveMode) => void
  busy: boolean
  /** Error or status line from the last action. */
  note: string | null
}

export function ItemDetails({ info, total, onEnter, onRemove, busy, note }: ItemDetailsProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => setCopied(false), [info?.node.id])

  if (!info) {
    return (
      <Card className="flex-row items-center px-5 py-4 text-sm text-muted-foreground">
        Selecione uma pasta ou arquivo para ver os detalhes.
      </Card>
    )
  }

  const { node, path, trail } = info
  const isRoot = trail.length <= 1
  const isDir = node.kind === 'dir'
  const Icon = isDir ? RiFolderOpenLine : RiFileLine

  const copy = async (): Promise<void> => {
    await window.api.item.copyPath(node.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card aria-label="Detalhes do item selecionado" className="flex-row flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
      <div className="flex min-w-60 flex-1 basis-72 items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon size={20} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-base font-semibold">{node.name}</span>
          <span className="selectable truncate font-mono text-xs text-muted-foreground" title={path}>
            {path}
          </span>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-7 gap-y-2">
        <div>
          <dt className="text-xs text-muted-foreground">Tamanho em disco</dt>
          <dd className="text-sm font-semibold tabular-nums">{formatBytes(node.alloc)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Do total escaneado</dt>
          <dd className="text-sm font-semibold tabular-nums">{formatPercent(node.alloc, total)}</dd>
        </div>
        {isDir && (
          <div>
            <dt className="text-xs text-muted-foreground">Arquivos</dt>
            <dd className="text-sm font-semibold tabular-nums">{formatInt(node.files)}</dd>
          </div>
        )}
      </dl>
      <div className="ml-auto flex flex-wrap gap-2">
        {isDir && (
          <Button variant="outline" size="sm" onClick={() => onEnter(node.id)}>
            <RiFolderOpenLine aria-hidden />
            Entrar
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => void window.api.item.showInFolder(node.id)}>
          <RiExternalLinkLine aria-hidden />
          Abrir no Explorer
        </Button>
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <RiCheckLine aria-hidden /> : <RiFileCopyLine aria-hidden />}
          {copied ? 'Copiado' : 'Copiar caminho'}
        </Button>
        {!isRoot && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              title="Mover para a Lixeira (Delete)"
              className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onRemove('trash')}
            >
              <RiDeleteBinLine aria-hidden />
              Mover para a Lixeira
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              title="Excluir permanentemente, sem passar pela Lixeira (Shift+Delete)"
              onClick={() => onRemove('delete')}
            >
              <RiDeleteBin2Line aria-hidden />
              Excluir permanentemente
            </Button>
          </>
        )}
      </div>
      {info.categories && <CategoryBreakdown bytes={info.categories} compact limit={5} className="basis-full" />}
      {note && <p className="selectable basis-full text-xs text-destructive">{note}</p>}
    </Card>
  )
}
