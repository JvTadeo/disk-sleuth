/**
 * Program detector types shared by the main process and the window.
 */

export type ProgramStatus = 'reg' | 'unreg' | 'orphan'

/** How sure the detector is about the status. Orphans found by heuristics are only "likely". */
export type Confidence = 'high' | 'likely'

export type ProgramKind = 'win32' | 'store' | 'folder'

/** Why a program got its status. The window turns this into a sentence. */
export type ReasonCode =
  | 'registered' // listed in "Add or remove programs"
  | 'store' // Microsoft Store package
  | 'systemComponent' // registered but hidden by Windows (runtimes, drivers, components)
  | 'noRegistryWithExe' // folder with executables and no registry entry: portable or copied install
  | 'leftoverFolder' // program folder with no executables and no owner
  | 'leftoverData' // large data folder in AppData/ProgramData that matches no installed program
  | 'registryMissingFolder' // registry entry whose install folder no longer exists

export interface ProgramSources {
  /** Has an entry in the Uninstall registry keys. */
  registry: boolean
  /** Has a folder on disk. */
  folder: boolean
  /** Has a Start menu shortcut pointing into its folder. */
  shortcut: boolean
  /** Is a Microsoft Store package. */
  store: boolean
}

export interface Program {
  /** Stable id for this detection run (the window only ever sends this back). */
  id: string
  name: string
  publisher?: string
  version?: string
  status: ProgramStatus
  confidence: Confidence
  kind: ProgramKind
  reason: ReasonCode
  /** Install folder, when known. */
  location?: string
  /** Size in bytes, when known. */
  size?: number
  /** Where `size` came from: the disk scan (exact) or the registry estimate. */
  sizeSource?: 'scan' | 'registry'
  sources: ProgramSources
  /** "machine" (all users) or "user" (current user only). */
  scope?: 'machine' | 'user'
  /** Hidden by Windows itself (system components). Not shown unless asked. */
  hidden: boolean
  /** Can be uninstalled through its official uninstaller / Windows Settings. */
  canUninstall: boolean
  /** The folder can be moved to the Recycle Bin from the app. */
  canTrash: boolean
  /** Executable whose icon represents the program (resolved by the main process). */
  iconPath?: string
}

export interface DetectionResult {
  programs: Program[]
  durationMs: number
  /** False when no disk scan was available, so sizes come from registry estimates and data leftovers are skipped. */
  usedScan: boolean
  /** Non-fatal problems (e.g. PowerShell blocked). */
  warnings: string[]
  /** Detection only works on Windows. */
  supported: boolean
  finishedAt: number
}
