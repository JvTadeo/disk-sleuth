import { formatBytes, formatInt } from '@shared/format'
import type { Program } from '@shared/programs'
import type { NodeInfo, ScanNode, ScanSummary } from '@shared/scan'

/**
 * Report builders. Pure functions over plain data: no Electron, easy to test.
 * The report copy is Brazilian Portuguese, like the rest of the UI.
 */

export interface ReportData {
  generatedAt: number
  summary: ScanSummary | null
  /** Top-level items of the scanned root, largest first. */
  topItems: ScanNode[]
  largestFiles: NodeInfo[]
  /** Visible programs (system components excluded), or null when detection never ran. */
  programs: Program[] | null
}

const STATUS: Record<Program['status'], string> = {
  reg: 'Registrado',
  unreg: 'Não registrado',
  orphan: 'Órfão'
}

const statusText = (p: Program): string => STATUS[p.status] + (p.confidence === 'likely' ? ' (provável)' : '')

const join = (root: string, name: string): string => (root.endsWith('\\') || root.endsWith('/') ? root + name : `${root}\\${name}`)

const when = (ms: number): string =>
  new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// ---------- CSV ----------

/** Quotes a cell when needed and neutralizes values Excel would run as formulas. */
function cell(v: string | number | undefined): string {
  if (v === undefined) return ''
  let s = String(v)
  if (/^[=+@\t\r]/.test(s)) s = `'${s}`
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * One flat table, so it can be sorted and filtered in Excel.
 * Semicolons and a UTF-8 BOM: what Excel expects on a Brazilian-locale Windows.
 */
export function buildCsv(d: ReportData): string {
  const rows: (string | number | undefined)[][] = [
    ['Tipo', 'Nome', 'Estado', 'Tamanho (bytes)', 'Tamanho', 'Arquivos', 'Local']
  ]
  if (d.summary) {
    for (const n of d.topItems) {
      if (n.grouped) continue
      rows.push([n.kind === 'dir' ? 'Pasta' : 'Arquivo', n.name, '', n.alloc, formatBytes(n.alloc), n.files, join(d.summary.root, n.name)])
    }
    for (const f of d.largestFiles) {
      rows.push(['Arquivo grande', f.node.name, '', f.node.alloc, formatBytes(f.node.alloc), 1, f.path])
    }
  }
  for (const p of d.programs ?? []) {
    rows.push(['Programa', p.name, statusText(p), p.size, p.size !== undefined ? formatBytes(p.size) : '', undefined, p.location])
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n'
}

// ---------- HTML ----------

const esc = (s: string | number | undefined): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function bar(value: number, max: number): string {
  const pct = max > 0 ? Math.max(0.5, (value / max) * 100) : 0
  return `<div class="bar"><span style="width:${pct.toFixed(1)}%"></span></div>`
}

/** A self-contained page (inline CSS, no scripts) that opens in any browser and prints cleanly. */
export function buildHtml(d: ReportData): string {
  const s = d.summary
  const parts: string[] = []

  if (s) {
    const max = d.topItems[0]?.alloc ?? 0
    parts.push(`
<section>
  <h2>Varredura de ${esc(s.root)}</h2>
  <dl class="stats">
    <div><dt>Tamanho em disco</dt><dd>${esc(formatBytes(s.alloc))}</dd></div>
    <div><dt>Arquivos</dt><dd>${esc(formatInt(s.files))}</dd></div>
    <div><dt>Pastas</dt><dd>${esc(formatInt(s.dirs))}</dd></div>
    <div><dt>Feita em</dt><dd>${esc(when(s.finishedAt))}</dd></div>
  </dl>
  ${s.inaccessible ? `<p class="note">${esc(formatInt(s.inaccessible))} pastas não puderam ser lidas por falta de permissão e não entram no total.</p>` : ''}
  <h3>Maiores itens</h3>
  <table>
    <thead><tr><th>Nome</th><th class="num">Tamanho</th><th class="num">%</th><th class="barcol"></th></tr></thead>
    <tbody>
${d.topItems
  .slice(0, 30)
  .map(
    (n) =>
      `      <tr><td>${n.grouped ? `<em>${esc(formatInt(n.groupedCount ?? 0))} itens menores</em>` : esc(n.name)}</td><td class="num">${esc(formatBytes(n.alloc))}</td><td class="num">${s.alloc ? Math.round((n.alloc / s.alloc) * 100) : 0}%</td><td>${bar(n.alloc, max)}</td></tr>`
  )
  .join('\n')}
    </tbody>
  </table>
</section>`)

    if (d.largestFiles.length) {
      const fmax = d.largestFiles[0].node.alloc
      parts.push(`
<section>
  <h3>Maiores arquivos</h3>
  <table>
    <thead><tr><th>#</th><th>Arquivo</th><th class="num">Tamanho</th><th class="barcol"></th></tr></thead>
    <tbody>
${d.largestFiles
  .map(
    (f, i) =>
      `      <tr><td class="num">${i + 1}</td><td>${esc(f.node.name)}<div class="path">${esc(f.path)}</div></td><td class="num">${esc(formatBytes(f.node.alloc))}</td><td>${bar(f.node.alloc, fmax)}</td></tr>`
  )
  .join('\n')}
    </tbody>
  </table>
</section>`)
    }
  }

  if (d.programs) {
    const attention = d.programs.filter((p) => p.status !== 'reg')
    const row = (p: Program): string =>
      `      <tr><td>${esc(p.name)}<div class="sub">${esc(p.publisher ?? '')}</div></td><td><span class="badge ${p.status}">${esc(statusText(p))}</span></td><td class="num">${p.size !== undefined ? esc((p.sizeSource === 'registry' ? '~' : '') + formatBytes(p.size)) : '—'}</td><td class="path">${esc(p.location ?? '—')}</td></tr>`
    const table = (list: Program[]): string => `
  <table>
    <thead><tr><th>Programa</th><th>Estado</th><th class="num">Tamanho</th><th>Local</th></tr></thead>
    <tbody>
${list.map(row).join('\n')}
    </tbody>
  </table>`
    parts.push(`
<section>
  <h2>Programas</h2>
  <p>${esc(formatInt(d.programs.length))} programas encontrados · ${esc(formatInt(attention.length))} precisam de atenção.</p>
  ${attention.length ? `<h3>Precisam de atenção</h3>${table(attention)}` : ''}
  <h3>Todos os programas</h3>${table(d.programs)}
</section>`)
  }

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório do disco · ${esc(when(d.generatedAt))}</title>
<style>
  :root { color-scheme: light; --fg: #09090b; --muted: #71717a; --line: #e4e4e7; --soft: #f4f4f5; --brand: #2563eb; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; color: var(--fg); background: #fff; }
  main { max-width: 1000px; margin: 0 auto; padding: 40px 24px 64px; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 16px; margin-bottom: 8px; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 18px; margin: 32px 0 12px; }
  h3 { font-size: 14px; margin: 24px 0 8px; color: var(--muted); font-weight: 600; }
  p { margin: 0 0 8px; }
  .muted, .path, .sub { color: var(--muted); }
  .sub { font-size: 12px; }
  .path { font: 12px/1.4 Consolas, monospace; word-break: break-all; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 0; }
  .stats div { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .stats dt { color: var(--muted); font-size: 12px; }
  .stats dd { margin: 2px 0 0; font-size: 18px; font-weight: 600; }
  .note { margin-top: 12px; padding: 8px 12px; border-radius: 8px; background: #fffbeb; color: #78350f; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 500; background: #fafafa; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .barcol { width: 22%; }
  .bar { height: 6px; border-radius: 99px; background: var(--soft); overflow: hidden; margin-top: 7px; }
  .bar span { display: block; height: 100%; background: var(--brand); border-radius: 99px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12px; font-weight: 500; white-space: nowrap; }
  .badge.reg { background: #dcfce7; color: #166534; }
  .badge.unreg { background: #fef3c7; color: #92400e; }
  .badge.orphan { background: #fee2e2; color: #991b1b; }
  @media print { main { padding: 0; } section { break-inside: avoid-page; } }
</style>
</head>
<body>
<main>
<header>
  <h1>Relatório do disco</h1>
  <p class="muted">Gerado pelo Analisador de Disco em ${esc(when(d.generatedAt))}</p>
</header>
${parts.join('\n') || '<p>Nada para relatar ainda: faça uma varredura ou detecte os programas.</p>'}
</main>
</body>
</html>
`
}
