import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DevArtifact, DevProject, DevTool } from '../shared/devjunk'
import type { ScanTree } from './tree'

/**
 * Finds rebuildable folders in a scan tree.
 *
 * A folder only counts when the file that proves what it is sits next to it: node_modules beside a
 * package.json, target beside a Cargo.toml, bin/obj beside a .csproj… Generic names such as dist, build
 * and out also need the project's .gitignore to list them, since some projects keep real files there.
 * Source code never matches: the rules only name generated folders.
 */

/** Projects whose rebuildable folders add up to less than this are left out (noise). */
export const MIN_PROJECT_BYTES = 1024 * 1024

/** Never walked into: huge, never contain projects of their own, or not ours to judge. */
const SKIP = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'windows', 'winsxs'])

const NODE_CACHES = new Set(['.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache', '.angular', '.docusaurus'])
/** Generic output names: only with a .gitignore entry. */
const NODE_OUTPUTS = new Set(['dist', 'build', 'out', '.output', 'coverage'])
const PY_CACHES = new Set(['.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox'])

interface Markers {
  node: boolean
  pm: 'npm' | 'pnpm' | 'yarn' | 'bun'
  cargo: boolean
  maven: boolean
  dotnet: boolean
  gradle: boolean
  flutter: boolean
  python: boolean
  unity: boolean
}

interface Rule {
  tool: DevTool
  rebuild: string
  /** Generic name: keep only if a .gitignore lists it. */
  needsIgnore?: boolean
}

function markersOf(files: Set<string>, dirs: Set<string>, fileNames: string[]): Markers {
  const pm = files.has('pnpm-lock.yaml')
    ? 'pnpm'
    : files.has('yarn.lock')
      ? 'yarn'
      : files.has('bun.lockb') || files.has('bun.lock')
        ? 'bun'
        : 'npm'
  return {
    node: files.has('package.json'),
    pm,
    cargo: files.has('cargo.toml'),
    maven: files.has('pom.xml'),
    dotnet: fileNames.some((n) => /\.(cs|fs|vb)proj$/.test(n)),
    gradle: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some((n) => files.has(n)),
    flutter: files.has('pubspec.yaml'),
    python: ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'pipfile', 'tox.ini'].some((n) => files.has(n)),
    unity: dirs.has('assets') && dirs.has('projectsettings')
  }
}

/** The rule a child folder named `name` (lower case) matches in a folder with these markers. */
export function ruleFor(name: string, m: Markers): Rule | null {
  if (m.cargo && name === 'target') return { tool: 'rust', rebuild: 'cargo build' }
  if (m.maven && name === 'target') return { tool: 'maven', rebuild: 'mvn package' }
  if (m.dotnet && (name === 'bin' || name === 'obj')) return { tool: 'dotnet', rebuild: 'dotnet build' }
  if (m.gradle && (name === '.gradle' || name === 'build')) return { tool: 'gradle', rebuild: 'gradlew build' }
  if (m.flutter && name === '.dart_tool') return { tool: 'flutter', rebuild: 'flutter pub get' }
  if (m.flutter && name === 'build') return { tool: 'flutter', rebuild: 'flutter build' }
  if (m.unity && (name === 'library' || name === 'temp')) return { tool: 'unity', rebuild: 'abrir o projeto no Unity' }
  if (m.python && PY_CACHES.has(name)) return { tool: 'python', rebuild: 'recriado ao rodar os testes' }
  if (m.node) {
    if (name === 'node_modules') return { tool: 'node', rebuild: `${m.pm} install` }
    if (NODE_CACHES.has(name)) return { tool: 'node', rebuild: `${m.pm} run build` }
    if (NODE_OUTPUTS.has(name)) {
      return { tool: 'node', rebuild: name === 'coverage' ? `${m.pm} test` : `${m.pm} run build`, needsIgnore: true }
    }
  }
  return null
}

/** True when a .gitignore line ignores a top-level folder named `name`. Only simple patterns are understood. */
export function gitignoreLists(content: string, name: string, atProjectLevel = true): boolean {
  const target = name.toLowerCase()
  let listed = false
  for (const raw of content.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const negated = line.startsWith('!')
    if (negated) line = line.slice(1)
    line = line.replace(/\\/g, '/')
    const anchored = line.startsWith('/')
    if (line.startsWith('**/')) line = line.slice(3)
    if (anchored) line = line.slice(1)
    if (line.endsWith('/**')) line = line.slice(0, -3)
    if (line.endsWith('/')) line = line.slice(0, -1)
    // An anchored pattern in a parent folder's .gitignore points somewhere else.
    if (anchored && !atProjectLevel) continue
    if (line.includes('/')) continue
    if (line.toLowerCase() === target) listed = !negated
  }
  return listed
}

interface RawArtifact {
  nodeId: number
  rebuild: string
  needsIgnore: boolean
}

interface RawProject {
  nodeId: number
  tools: Set<DevTool>
  artifacts: RawArtifact[]
}

/** Pass 1, in memory: walks the tree and applies the rules. */
export function findCandidates(tree: ScanTree): RawProject[] {
  const projects = new Map<number, RawProject>()
  const projectOf = (id: number): RawProject => {
    let p = projects.get(id)
    if (!p) {
      p = { nodeId: id, tools: new Set(), artifacts: [] }
      projects.set(id, p)
    }
    return p
  }
  if (!tree.length || !tree.isAlive(0)) return []

  const stack = [0]
  while (stack.length) {
    const id = stack.pop()!
    const files = new Set<string>()
    const dirs = new Set<string>()
    const fileNames: string[] = []
    const childDirs: { id: number; lower: string }[] = []
    tree.forEachChild(id, (c) => {
      const lower = tree.nameOf(c).toLowerCase()
      if (tree.isDir(c)) {
        dirs.add(lower)
        childDirs.push({ id: c, lower })
      } else {
        files.add(lower)
        fileNames.push(lower)
      }
    })

    // A Python virtual environment, whatever its name: everything in it is installed packages.
    if (id !== 0 && files.has('pyvenv.cfg')) {
      const parent = tree.parentOf(id)
      const p = projectOf(parent)
      p.tools.add('python')
      p.artifacts.push({ nodeId: id, rebuild: 'python -m venv + pip install', needsIgnore: false })
      continue
    }

    const m = markersOf(files, dirs, fileNames)
    for (const child of childDirs) {
      const rule = ruleFor(child.lower, m)
      if (rule) {
        const p = projectOf(id)
        p.tools.add(rule.tool)
        p.artifacts.push({ nodeId: child.id, rebuild: rule.rebuild, needsIgnore: !!rule.needsIgnore })
        continue
      }
      if (!SKIP.has(child.lower)) stack.push(child.id)
    }
  }
  return [...projects.values()]
}

/** The .gitignore files that apply to a project: its own, then up to three parent folders (monorepos). */
async function gitignores(projectPath: string): Promise<{ text: string; own: boolean }[]> {
  const out: { text: string; own: boolean }[] = []
  let dir = projectPath
  for (let level = 0; level < 4; level++) {
    try {
      out.push({ text: await readFile(join(dir, '.gitignore'), 'utf8'), own: level === 0 })
    } catch {
      // no .gitignore here
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return out
}

/**
 * When the project's own files last changed: git activity (commits, checkouts, staging), the files at the top of
 * the project and one level below (src/, app/…). Generated folders are skipped. Bounded to a few hundred stats.
 */
export async function lastActivity(projectPath: string, generated: Set<string>): Promise<number | null> {
  let latest = 0
  let budget = 400
  const take = async (p: string): Promise<void> => {
    if (budget-- <= 0) return
    try {
      const s = await stat(p)
      if (s.mtimeMs > latest) latest = s.mtimeMs
    } catch {
      // gone or unreadable
    }
  }
  await take(join(projectPath, '.git', 'logs', 'HEAD'))
  await take(join(projectPath, '.git', 'index'))
  const top = await readdir(projectPath, { withFileTypes: true }).catch(() => [])
  const subdirs: string[] = []
  for (const e of top) {
    const lower = e.name.toLowerCase()
    if (generated.has(lower) || SKIP.has(lower)) continue
    await take(join(projectPath, e.name))
    if (e.isDirectory() && !e.name.startsWith('.')) subdirs.push(join(projectPath, e.name))
  }
  for (const d of subdirs.slice(0, 12)) {
    const kids = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const k of kids.slice(0, 40)) await take(join(d, k.name))
  }
  return latest > 0 ? latest : null
}

/** Runs `fn` over items with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Pass 2, on disk: checks .gitignore for generic names, reads last activity, builds the result. */
export async function findDevProjects(tree: ScanTree, sep: string): Promise<DevProject[]> {
  const candidates = findCandidates(tree)
  const projects = await pool(candidates, 8, async (raw): Promise<DevProject | null> => {
    const path = tree.path(raw.nodeId, sep)
    let ignores: { text: string; own: boolean }[] | null = null
    const artifacts: DevArtifact[] = []
    for (const a of raw.artifacts) {
      const name = tree.nameOf(a.nodeId)
      if (a.needsIgnore) {
        ignores ??= await gitignores(path)
        if (!ignores.some((g) => gitignoreLists(g.text, name, g.own))) continue
      }
      const node = tree.node(a.nodeId)
      artifacts.push({ nodeId: a.nodeId, name, path: tree.path(a.nodeId, sep), alloc: node.alloc, files: node.files, rebuild: a.rebuild })
    }
    const alloc = artifacts.reduce((s, a) => s + a.alloc, 0)
    if (!artifacts.length || alloc < MIN_PROJECT_BYTES) return null
    artifacts.sort((a, b) => b.alloc - a.alloc)
    const generated = new Set(artifacts.map((a) => a.name.toLowerCase()))
    return {
      id: path.toLowerCase(),
      nodeId: raw.nodeId,
      name: tree.nameOf(raw.nodeId),
      path,
      tools: [...raw.tools],
      artifacts,
      alloc,
      lastActivity: await lastActivity(path, generated)
    }
  })
  return projects.filter((p): p is DevProject => p !== null).sort((a, b) => b.alloc - a.alloc)
}
