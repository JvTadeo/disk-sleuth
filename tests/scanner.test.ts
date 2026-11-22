/**
 * Scanner feature tests on real temporary folders: categories, scan comparison, duplicates, cache round-trip,
 * dev junk detection.
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
import { findDevProjects, gitignoreLists } from '../src/scanner/devjunk'

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

// ---------- dev junk ----------
ok(gitignoreLists('node_modules\n/dist\n', 'dist'), '.gitignore: anchored entry at project level')
ok(gitignoreLists('build/\n', 'build'), '.gitignore: trailing slash')
ok(!gitignoreLists('/dist\n', 'dist', false), '.gitignore: anchored entry in a parent folder points elsewhere')
ok(!gitignoreLists('dist\n!dist\n', 'dist'), '.gitignore: negation wins when it comes last')
ok(!gitignoreLists('src/dist\n', 'dist'), '.gitignore: nested paths are not top-level folders')

const dev = mkdtempSync(join(tmpdir(), 'da-dev-'))
const put = (rel: string, bytes: number | string) => {
  const p = join(dev, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, typeof bytes === 'number' ? randomBytes(bytes) : bytes)
}
// A Node project: node_modules, .next and a gitignored dist are junk; src is not.
put('web/package.json', '{}')
put('web/pnpm-lock.yaml', '')
put('web/.gitignore', 'node_modules\n/dist\n')
put('web/src/index.ts', 'export {}')
put('web/node_modules/react/index.js', 2 * MB)
put('web/node_modules/inner/node_modules/deep/x.js', 1000) // nested node_modules: counted inside the top one
put('web/.next/cache/a', MB)
put('web/dist/app.js', MB)
// dist without a .gitignore entry: kept (some projects commit their dist).
put('lib/package.json', '{}')
put('lib/dist/lib.js', 2 * MB)
put('lib/node_modules/x/i.js', 2 * MB)
// Rust, .NET and Python projects.
put('cli/Cargo.toml', '')
put('cli/target/debug/cli.exe', 3 * MB)
put('api/Api.csproj', '<Project/>')
put('api/bin/Debug/api.dll', MB)
put('api/obj/project.assets.json', MB)
put('ml/requirements.txt', 'numpy')
put('ml/.venv/pyvenv.cfg', 'home = C:\\Python')
put('ml/.venv/Lib/site-packages/numpy/core.pyd', 2 * MB)
// Look-alikes that must NOT match: a target folder without Cargo.toml, a global node_modules without package.json,
// a build folder in a plain folder, and a project with almost nothing to free.
put('docs/target/plan.pdf', 2 * MB)
put('npm-global/node_modules/typescript/tsc.js', 2 * MB)
put('photos/build/img.jpg', 2 * MB)
put('tiny/package.json', '{}')
put('tiny/node_modules/a.js', 1000)

try {
  const { tree } = await scan(dev)
  const projects = await findDevProjects(tree, sep)
  const by = (name: string) => projects.find((p) => p.name === name)
  const names = (name: string) => by(name)?.artifacts.map((a) => a.name).sort().join(',')
  ok(names('web') === '.next,dist,node_modules', `web: node_modules, .next and gitignored dist (got ${names('web')})`)
  ok(by('web')!.artifacts.find((a) => a.name === 'node_modules')!.rebuild === 'pnpm install', 'lock file picks the package manager')
  ok(names('lib') === 'node_modules', `lib: dist without .gitignore is kept (got ${names('lib')})`)
  ok(names('cli') === 'target' && by('cli')!.tools.includes('rust'), 'Rust target')
  ok(names('api') === 'bin,obj' && by('api')!.artifacts[0].rebuild === 'dotnet build', '.NET bin and obj')
  ok(names('ml') === '.venv' && by('ml')!.tools.includes('python'), 'Python virtual environment by pyvenv.cfg')
  ok(!by('docs') && !by('npm-global') && !by('photos'), 'look-alikes are ignored')
  ok(!by('tiny'), 'projects under 1 MB are left out')
  ok(projects.every((p) => p.artifacts.every((a) => a.path.startsWith(p.path))), 'artifacts live inside their project')
  ok(projects.every((p) => typeof p.lastActivity === 'number' && p.lastActivity > Date.now() - 3600_000), 'last activity read from disk')
  ok(projects[0].alloc >= projects[projects.length - 1].alloc, 'largest projects first')
} finally {
  rmSync(dev, { recursive: true, force: true })
}

console.log(`All ${checks} scanner checks passed`)
