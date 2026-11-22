/**
 * Raw facts collected from Windows, before any classification.
 * Kept as plain data so the classifier can be unit-tested with fixtures.
 */

export interface RegistryEntry {
  key: string
  /** "64" / "32" (HKLM views) or "user" (HKCU). */
  view: '64' | '32' | 'user'
  name: string
  version?: string
  publisher?: string
  installLocation?: string
  uninstallString?: string
  quietUninstallString?: string
  displayIcon?: string
  estimatedSizeKb?: number
  systemComponent?: boolean
  parentKeyName?: string
  releaseType?: string
  /** Filled by the collector: does installLocation exist on disk? */
  locationExists?: boolean
  /** Filled by the collector: the program executable named by DisplayIcon, if any. */
  iconExe?: string
  iconExeExists?: boolean
  /** Filled by the collector: the uninstaller named by UninstallString (not MsiExec or a shared cache). */
  uninstallExe?: string
  uninstallExeExists?: boolean
}

export interface AppxEntry {
  name: string
  packageFullName: string
  publisher?: string
  version?: string
  installLocation?: string
  nonRemovable?: boolean
}

export interface ShortcutEntry {
  name: string
  target: string
}

export type FolderArea =
  | 'programFiles'
  | 'programFilesX86'
  | 'localPrograms'
  | 'driveRoot'
  | 'appDataLocal'
  | 'appDataRoaming'
  | 'programData'

export interface FolderCandidate {
  path: string
  name: string
  area: FolderArea
  /** Executables found within two levels, relative to `path` (a few, for icons and display). */
  exes: string[]
  /** Set when the folder sits inside a vendor/container folder (e.g. "Adobe\Acrobat DC"). */
  container?: string
}

export interface Inventory {
  registry: RegistryEntry[]
  appx: AppxEntry[]
  shortcuts: ShortcutEntry[]
  folders: FolderCandidate[]
  warnings: string[]
}

/** Paths of the well-known areas, from the environment. */
export interface Areas {
  programFiles?: string
  programFilesX86?: string
  localPrograms?: string
  appDataLocal?: string
  appDataRoaming?: string
  programData?: string
  systemRoot?: string
  /** C:\Users\<name>: never a program location. */
  userProfile?: string
}
