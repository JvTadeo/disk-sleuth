/**
 * Scanner benchmark.
 *
 *   npm run bench -- C:\
 *   npm run bench -- "D:\Games" --workers 32 --stat 16 --pool 32 --json
 *
 * Runs the same scanner the app uses, in this process, and prints speed and memory.
 */

// libuv runs file system calls on its thread pool (4 threads by default).
// It must be set before the first fs call, so this stays at the very top.
{
  const i = process.argv.indexOf('--pool')
  if (i > 0 && process.argv[i + 1]) process.env.UV_THREADPOOL_SIZE = process.argv[i + 1]
}
process.env.UV_THREADPOOL_SIZE ??= '32'

import { scan, PATH_SEP } from '../src/scanner/scan'

interface Args {
  root: string
  workers: number
  stat: number
  json: boolean
  top: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { root: '', workers: 32, stat: 16, json: false, top: 10 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workers') args.workers = Number(argv[++i])
    else if (a === '--stat') args.stat = Number(argv[++i])
    else if (a === '--top') args.top = Number(argv[++i])
    else if (a === '--pool') i++ // handled at the top of the file
    else if (a === '--json') args.json = true
    else if (a === '--help' || a === '-h') {
      console.log('Usage: npm run bench -- <folder> [--workers 32] [--stat 16] [--pool 32] [--top 10] [--json]')
      process.exit(0)
    } else if (!args.root) args.root = a
  }
  if (!args.root) args.root = process.platform === 'win32' ? 'C:\\' : '/'
  return args
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
function bytes(n: number): string {
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${UNITS[i]}`
}
const int = (n: number): string => Math.round(n).toLocaleString('en-US')

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  let peakRss = 0
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, 100)

  const ac = new AbortController()
  process.on('SIGINT', () => {
    console.log('\nCancelling…')
    ac.abort()
  })

  const tty = process.stdout.isTTY && !args.json
  if (!args.json) {
    console.log(`Scanning ${args.root}  (workers: ${args.workers}, stat concurrency: ${args.stat}, ` +
      `UV_THREADPOOL_SIZE: ${process.env.UV_THREADPOOL_SIZE})`)
  }

  const { tree, summary } = await scan(args.root, {
    dirWorkers: args.workers,
    statConcurrency: args.stat,
    signal: ac.signal,
    progressIntervalMs: 250,
    onProgress: tty
      ? (p) => {
          const rate = p.elapsedMs ? (p.files / p.elapsedMs) * 1000 : 0
          process.stdout.write(
            `\r  ${int(p.files)} files · ${int(p.dirs)} folders · ${bytes(p.bytes)} · ` +
              `${int(rate)} files/s · ${(p.elapsedMs / 1000).toFixed(1)} s   `
          )
        }
      : undefined
  })

  clearInterval(sampler)
  peakRss = Math.max(peakRss, process.memoryUsage().rss)
  if (tty) process.stdout.write('\n')

  const mem = process.memoryUsage()
  const filesPerSec = summary.durationMs ? (summary.files / summary.durationMs) * 1000 : 0
  const top = tree.children(summary.rootId, args.top, PATH_SEP)?.children ?? []

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ...summary,
          filesPerSec: Math.round(filesPerSec),
          peakRssBytes: peakRss,
          heapUsedBytes: mem.heapUsed,
          treeArrayBytes: tree.arrayBytes,
          top: top.map((n) => ({ name: n.name, alloc: n.alloc, size: n.size, files: n.files }))
        },
        null,
        2
      )
    )
    return
  }

  const rows: [string, string][] = [
    ['Status', summary.cancelled ? 'cancelled' : 'complete'],
    ['Duration', `${(summary.durationMs / 1000).toFixed(2)} s`],
    ['Speed', `${int(filesPerSec)} files/s`],
    ['Files', int(summary.files)],
    ['Folders', int(summary.dirs)],
    ['Size', bytes(summary.size)],
    ['Size on disk', summary.allocSupported ? bytes(summary.alloc) : 'not reported by this file system'],
    ['Hard links counted once', int(summary.hardlinksSkipped)],
    ['Symlinks/junctions skipped', int(summary.linksSkipped)],
    ['Inaccessible folders', int(summary.inaccessible)],
    ['Peak memory (RSS)', bytes(peakRss)],
    ['JS heap after scan', bytes(mem.heapUsed)],
    ['Tree arrays', `${bytes(tree.arrayBytes)} for ${int(summary.nodes)} nodes`]
  ]
  const w = Math.max(...rows.map((r) => r[0].length))
  console.log('')
  for (const [k, v] of rows) console.log(`  ${k.padEnd(w)}  ${v}`)

  console.log(`\n  Largest in ${args.root}`)
  for (const n of top) {
    const label = n.grouped ? `(${n.groupedCount} smaller items)` : n.name + (n.kind === 'dir' ? PATH_SEP : '')
    console.log(`    ${bytes(n.alloc).padStart(9)}  ${label}`)
  }
  if (summary.inaccessibleSample.length) {
    console.log('\n  Some inaccessible folders (run as administrator to include them):')
    for (const p of summary.inaccessibleSample.slice(0, 5)) console.log(`    ${p}`)
  }

  console.log('\n  Roadmap targets: 1M files in < 90 s on an SSD; < 400 MB memory with 1M files.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
