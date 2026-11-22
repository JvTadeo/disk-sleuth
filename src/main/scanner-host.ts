import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type {
  DuplicateProgress,
  DuplicateResult,
  ScannerMessage,
  ScannerQueryMap,
  ScannerRequest,
  ScanProgress,
  ScanSummary
} from '@shared/scan'

export interface ScannerEvents {
  onProgress: (p: ScanProgress) => void
  onDone: (s: ScanSummary) => void
  onError: (message: string) => void
  onDupProgress: (p: DuplicateProgress) => void
  onDupDone: (r: DuplicateResult) => void
  onDupError: (message: string) => void
}

/**
 * Owns the scanner utilityProcess.
 *
 * The process is started lazily and kept alive after a scan, because it holds the tree
 * the window queries. A new scan replaces the tree; quitting the app ends the process.
 */
export class ScannerHost {
  private proc: UtilityProcess | null = null
  private nextReqId = 1
  private pending = new Map<number, (r: unknown) => void>()
  private scanning = false

  constructor(private events: ScannerEvents) {}

  get isScanning(): boolean {
    return this.scanning
  }

  private ensure(): UtilityProcess {
    if (this.proc) return this.proc
    const proc = utilityProcess.fork(join(__dirname, 'scanner.js'), [], {
      serviceName: 'Disk Analyzer Scanner',
      env: { ...process.env, UV_THREADPOOL_SIZE: '32' },
      stdio: 'inherit'
    })
    proc.on('message', (msg: ScannerMessage) => this.handle(msg))
    proc.on('exit', (code) => {
      this.proc = null
      for (const resolve of this.pending.values()) resolve(null)
      this.pending.clear()
      if (this.scanning) {
        this.scanning = false
        this.events.onError(`Scanner process exited unexpectedly (code ${code}).`)
      }
    })
    this.proc = proc
    return proc
  }

  private send(req: ScannerRequest): void {
    this.ensure().postMessage(req)
  }

  private handle(msg: ScannerMessage): void {
    switch (msg.type) {
      case 'progress':
        this.events.onProgress(msg.progress)
        break
      case 'done':
        this.scanning = false
        this.events.onDone(msg.summary)
        break
      case 'error':
        this.scanning = false
        this.events.onError(msg.message)
        break
      case 'dupProgress':
        this.events.onDupProgress(msg.progress)
        break
      case 'dupDone':
        this.events.onDupDone(msg.result)
        break
      case 'dupError':
        this.events.onDupError(msg.message)
        break
      case 'reply': {
        const resolve = this.pending.get(msg.reqId)
        this.pending.delete(msg.reqId)
        if (msg.error) console.error('[scanner] query failed:', msg.error)
        resolve?.(msg.result)
        break
      }
    }
  }

  start(root: string): void {
    this.scanning = true
    this.send({ type: 'scan', root })
  }

  startDuplicates(minSize: number): boolean {
    if (!this.proc) return false
    this.proc.postMessage({ type: 'duplicates', minSize } satisfies ScannerRequest)
    return true
  }

  cancelDuplicates(): void {
    this.proc?.postMessage({ type: 'cancelDuplicates' } satisfies ScannerRequest)
  }

  cancel(): void {
    if (this.proc && this.scanning) this.proc.postMessage({ type: 'cancel' } satisfies ScannerRequest)
  }

  /** Runs a query against the tree in the scanner process. Resolves to null when there is no tree. */
  query<K extends keyof ScannerQueryMap>(
    kind: K,
    params: ScannerQueryMap[K][0]
  ): Promise<ScannerQueryMap[K][1] | null> {
    // "load" starts the process (restoring a saved tree); other queries need a tree to exist.
    if (!this.proc && kind !== 'load') return Promise.resolve(null)
    const reqId = this.nextReqId++
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve as (r: unknown) => void)
      this.send({ type: 'query', reqId, query: { kind, params } as never })
    })
  }

  dispose(): void {
    this.proc?.kill()
    this.proc = null
  }
}
