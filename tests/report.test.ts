/**
 * Report builder tests. Run: npm run test:report
 */
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { buildCsv, buildHtml, type ReportData } from '../src/main/report'

const GB = 1024 ** 3
const data: ReportData = {
  generatedAt: Date.UTC(2026, 10, 21, 15, 0),
  summary: {
    root: 'C:\\', rootId: 0, files: 1217498, dirs: 260743, size: 491 * GB, alloc: 492 * GB, allocSupported: true,
    hardlinksSkipped: 77680, linksSkipped: 1839, inaccessible: 623, inaccessibleSample: [], durationMs: 52270,
    finishedAt: Date.UTC(2026, 10, 21, 14, 50), nodes: 1478241, cancelled: false
  },
  topItems: [
    { id: 1, name: 'Games', kind: 'dir', size: 274 * GB, alloc: 274 * GB, files: 90000 },
    { id: 2, name: 'Users', kind: 'dir', size: 125 * GB, alloc: 125 * GB, files: 400000 },
    { id: 3, name: '=cmd|evil', kind: 'file', size: 1, alloc: 4096, files: 1 },
    { id: -1, name: '', kind: 'dir', size: 1000, alloc: 4096, files: 12, grouped: true, groupedCount: 12 }
  ],
  largestFiles: [
    { node: { id: 9, name: 'pagefile.sys', kind: 'file', size: 16 * GB, alloc: 16 * GB, files: 1 }, path: 'C:\\pagefile.sys', trail: [] }
  ],
  programs: [
    { id: 'a', name: 'Java 8 Update 381', publisher: 'Oracle', status: 'orphan', confidence: 'high', kind: 'win32', reason: 'registryMissingFolder', sources: { registry: true, folder: false, shortcut: false, store: false }, hidden: false, canUninstall: false, canTrash: false },
    { id: 'b', name: 'Tool "quoted"; with semicolon', status: 'unreg', confidence: 'high', kind: 'folder', reason: 'noRegistryWithExe', location: 'C:\\Tools\\x', size: 28 * 1024 ** 2, sizeSource: 'scan', sources: { registry: false, folder: true, shortcut: false, store: false }, hidden: false, canUninstall: false, canTrash: true },
    { id: 'c', name: '<script>alert(1)</script>', status: 'reg', confidence: 'high', kind: 'win32', reason: 'registered', size: 2 * GB, sizeSource: 'registry', sources: { registry: true, folder: true, shortcut: false, store: false }, hidden: false, canUninstall: true, canTrash: false }
  ]
}

const csv = buildCsv(data)
assert.ok(csv.startsWith('\uFEFFTipo;Nome;Estado'), 'BOM + semicolon header')
assert.ok(csv.includes('Pasta;Games;;294205259776;274 GB;90000;C:\\Games'), 'folder row')
assert.ok(csv.includes("'=cmd|evil"), 'formula neutralized')
assert.ok(csv.includes('"Tool ""quoted""; with semicolon"'), 'quoting')
assert.ok(!csv.includes('itens menores'), 'grouped row skipped')
assert.ok(csv.includes('Programa;Java 8 Update 381;Órfão;'), 'program row')

const html = buildHtml(data)
assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !html.includes('<script>alert'), 'HTML escaped')
assert.ok(html.includes('623 pastas não puderam ser lidas'), 'inaccessible note')
assert.ok(html.includes('~2 GB'), 'registry estimate marked')
assert.ok(html.includes('12 itens menores'), 'grouped row shown in HTML')

mkdirSync('out/tests', { recursive: true })
writeFileSync('out/tests/report-sample.html', html)
writeFileSync('out/tests/report-sample.csv', csv)
console.log('All report checks passed (samples in out/tests/)')
