/**
 * "Dev junk": folders a command can rebuild (node_modules, target, bin/obj, virtual environments…)
 * and the global package caches of developer tools.
 */

import type { ScanNode } from './scan'

export type DevTool = 'node' | 'rust' | 'dotnet' | 'python' | 'gradle' | 'maven' | 'flutter' | 'unity'

/** One rebuildable folder inside a project. */
export interface DevArtifact {
  /** Node id in the current scan tree. */
  nodeId: number
  name: string
  path: string
  /** Size on disk. */
  alloc: number
  files: number
  /** How it comes back, e.g. "npm install". */
  rebuild: string
}

export interface DevProject {
  /** Stable key: the project path, lower case. */
  id: string
  nodeId: number
  name: string
  path: string
  tools: DevTool[]
  artifacts: DevArtifact[]
  /** Sum of the artifacts. */
  alloc: number
  /**
   * Last change to the project's own files (sources, manifest, git history), in ms since epoch.
   * Generated folders are ignored. Null when it could not be read.
   */
  lastActivity: number | null
}

export interface DevCache {
  /** Fixed id, e.g. "npm". */
  id: string
  name: string
  path: string
  /** Size on disk; null when it could not be measured. */
  alloc: number | null
  files: number | null
  /** Official cleanup command, when the tool has one (run when the tool is installed). */
  command: string | null
  /** Short note on what happens after cleaning. */
  note: string
}

export interface DevJunkResult {
  /** Root of the scan the projects came from; null without a scan. */
  root: string | null
  /** Finished-at time of that scan: results are only valid for the same tree. */
  scanKey: number | null
  generatedAt: number
  durationMs: number
  projects: DevProject[]
  caches: DevCache[]
}

/** What to clean: artifact node ids (from the last result) and cache ids. */
export interface DevCleanRequest {
  artifacts: number[]
  caches: string[]
}

export interface DevCleanResult {
  /** False when the user cancelled. */
  done: boolean
  removed: number
  failed: number
  /** Bytes freed, as measured (artifacts by their scanned size, caches before vs after). */
  freed: number
  /** New totals of the scan root, when the scan tree changed. */
  root: ScanNode | null
  /** Human-readable notes about failures (in Portuguese, shown as is). */
  notes: string[]
  /** The list after cleaning. */
  result: DevJunkResult | null
}
