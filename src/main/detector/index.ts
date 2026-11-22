import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DriveInfo } from '@shared/ipc'
import type { DetectionResult, Program } from '@shared/programs'
import { classify } from './classify'
import { areasFromEnv, collectInventory } from './collect'
import type { Areas, Inventory } from './inventory'

export interface DetectorDeps {
  /** Sizes from the current disk scan, or null when there is no scan. */
  sizes: (paths: string[]) => Promise<(number | null)[] | null>
}

/**
 * Runs detection and keeps the last result. Commands (uninstall strings) stay here in the
 * main process: the window only ever sees program ids.
 */
export class ProgramDetector {
  private last: DetectionResult | null = null
  private byId = new Map<string, Program>()
  private uninstall = new Map<string, string>()
  private running: Promise<DetectionResult> | null = null

  constructor(private deps: DetectorDeps) {}

  get result(): DetectionResult | null {
    return this.last
  }

  get(id: string): Program | undefined {
    return this.byId.get(id)
  }

  uninstallCommand(id: string): string | undefined {
    return this.uninstall.get(id)
  }

  /** Drops a program from the result (after its folder went to the Recycle Bin). */
  forget(id: string): void {
    this.byId.delete(id)
    if (this.last) this.last = { ...this.last, programs: this.last.programs.filter((p) => p.id !== id) }
  }

  detect(drives: DriveInfo[]): Promise<DetectionResult> {
    // Concurrent requests share one run.
    this.running ??= this.run(drives).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(drives: DriveInfo[]): Promise<DetectionResult> {
    const started = performance.now()

    // Debugging aid: DISK_ANALYZER_INVENTORY=<file.json> replays a saved { inventory, areas } instead of reading Windows.
    const replay = process.env.DISK_ANALYZER_INVENTORY
    let inv: Inventory
    let areas: Areas
    if (replay) {
      const saved = JSON.parse(await readFile(replay, 'utf8')) as { inventory: Inventory; areas: Areas }
      inv = saved.inventory
      areas = saved.areas
    } else if (process.platform === 'win32') {
      inv = await collectInventory(drives)
      areas = areasFromEnv()
    } else {
      this.last = { programs: [], durationMs: 0, usedScan: false, warnings: [], supported: false, finishedAt: Date.now() }
      return this.last
    }

    // One batched lookup for every path whose size might be shown.
    const paths = new Set<string>()
    for (const f of inv.folders) paths.add(f.path)
    for (const r of inv.registry) {
      if (r.installLocation) paths.add(r.installLocation)
      if (r.iconExe) paths.add(dirname(r.iconExe))
    }
    for (const a of inv.appx) if (a.installLocation) paths.add(a.installLocation)
    const list = [...paths]
    const sizes = await this.deps.sizes(list)
    const sizeMap = new Map<string, number>()
    if (sizes) list.forEach((p, i) => sizes[i] !== null && sizeMap.set(p.toLowerCase().replace(/\\+$/, ''), sizes[i]!))

    const programs = classify(inv, {
      areas,
      driveRoots: drives.map((d) => d.root),
      sizeOf: sizes ? (p) => sizeMap.get(p.toLowerCase().replace(/\\+$/, '')) : undefined
    })

    this.byId = new Map(programs.map((p) => [p.id, p]))
    this.uninstall = new Map()
    for (const r of inv.registry) {
      const cmd = r.uninstallString
      if (cmd) this.uninstall.set(`reg:${r.view}:${r.key}`, cmd)
    }

    this.last = {
      programs,
      durationMs: Math.round(performance.now() - started),
      usedScan: !!sizes,
      warnings: inv.warnings,
      supported: true,
      finishedAt: Date.now()
    }
    return this.last
  }
}
