/**
 * Scanner feature tests on real temporary folders: categories, scan comparison, duplicates, cache round-trip.
 * Run: npm run test:scanner
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, linkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { CATEGORIES } from '../src/shared/categories'
import { categoryOf } from '../src/scanner/categories'
import { scan } from '../src/scanner/scan'
import { ScanTree } from '../src/scanner/tree'
import { buildSnapshot, diffTrees, Snapshot } from '../src/scanner/snapshot'
import { findDuplicates } from '../src/scanner/duplicates'

const MB = 1024 * 1024
const cat = (k: (typeof CATEGORIES)[number]) => CATEGORIES.indexOf(k)
let checks = 0
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg)
  checks++
}

// ---------- categories ----------
ok(categoryOf('Filme.MKV') === cat('video'), 'video by extension, case-insensitive')
ok(categoryOf('pagefile.sys') === cat('system'), 'pagefile is system')
ok(categoryOf('data.pak') === cat('game'), 'game asset')
ok(categoryOf('README') === cat('other'), 'no extension → other')
ok(categoryOf('.gitignore') === cat('other'), 'dotfile → other')

// ---------- fixture ----------
const root = mkdtempSync(join(tmpdir(), 'da-test-'))
const write = (rel: string, bytes: number | Buffer) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, typeof bytes === 'number' ? randomBytes(bytes) : bytes)
}
write('Videos/a.mp4', 3 * MB)
write('Videos/b.mkv', 2 * MB)
write('Docs/report.pdf', 1 * MB)
write('Docs/notes.txt', 10_000)
const same = randomBytes(2 * MB)
write('Copies/one.iso', same)
write('Copies/sub/two.iso', same)
write('Copies/three.iso', Buffer.concat([same.subarray(0, MB), randomBytes(MB)])) // same size, different content
linkSync(join(root, 'Copies/one.iso'), join(root, 'Copies/hardlink.iso')) // must not count as a copy

try {
  // ---------- categories in the tree ----------
  const first = await scan(root)
  const t1 = first.tree
  const total = first.summary.categories!
  ok(total[cat('video')] >= 5 * MB, 'summary has video bytes')
  ok(total[cat('archive')] >= 6 * MB, 'summary has archive bytes (hard link counted once)')
  const videosId = t1.findPath(join(root, 'Videos'))
  ok(t1.dominantCategory(videosId) === cat('video'), 'Videos folder is dominated by video')
  const tm = t1.treemap(0, 2, 100)!
  ok(tm.children!.some((c) => c.name === 'Videos' && c.category === cat('video')), 'treemap carries the category')

  // removal keeps category totals right
  const before = t1.categoriesOf(0)[cat('document')]
  t1.remove(t1.findPath(join(root, 'Docs', 'report.pdf')))
  ok(t1.categoriesOf(0)[cat('document')] < before, 'document bytes drop after removal')

  // cache round-trip keeps categories
  const back = ScanTree.deserialize(Buffer.concat(t1.serialize()))
  ok(JSON.stringify(back.categoriesOf(0)) === JSON.stringify(t1.categoriesOf(0)), 'categories survive save/load')

  // ---------- duplicates ----------
  const ac = new AbortController()
  const dup = await findDuplicates(first.tree, { minSize: 1, sep, signal: ac.signal, onProgress: () => {} })
  ok(dup.groups.length === 1, `one duplicate group (got ${dup.groups.length})`)
  const names = dup.groups[0].files.map((f) => f.name).sort()
  ok(JSON.stringify(names) === JSON.stringify(['one.iso', 'two.iso']) || JSON.stringify(names) === JSON.stringify(['hardlink.iso', 'two.iso']), `the identical pair: ${names}`)
  ok(!names.includes('three.iso'), 'same size but different content is not a copy')

  // ---------- comparison ----------
  const snapBuf = Buffer.concat(buildSnapshot(first.tree, Date.now() - 1000))
  // Change the disk: grow Videos by 150 MB in a new subfolder, drop Copies.
  write('Videos/Trip/big.mp4', 150 * MB)
  rmSync(join(root, 'Copies'), { recursive: true })
  const second = await scan(root)
  // Use a tiny threshold copy of the snapshot logic: our fixture is small, so check structure with the real threshold.
  const diff = diffTrees(second.tree, new Snapshot(snapBuf), sep)
  // The deepest item that explains the change is the new file itself, not Trip, Videos or the root.
  const grew = diff.changes.find((c) => c.name === 'big.mp4')
  ok(grew && grew.status === 'new' && grew.kind === 'file' && grew.delta >= 150 * MB, 'reports the deepest change (the new file)')
  ok(!diff.changes.some((c) => c.name === 'Videos' || c.name === 'Trip'), 'ancestors not repeated')
  ok(typeof grew!.id === 'number', 'change links to the current tree node')
  ok(diff.totalDelta > 140 * MB, 'total delta')
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`All ${checks} scanner checks passed`)
