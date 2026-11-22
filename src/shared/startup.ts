/** Programs that start with Windows ("Inicialização" page). */

import type { ProgramStatus } from './programs'

/**
 * Where Windows keeps the entry:
 * - runUser / runMachine / runMachine32: the Run registry keys (this user; all users 64-bit; all users 32-bit)
 * - folderUser / folderCommon: the Startup folders (this user; all users)
 * - task: a scheduled task that runs at logon or boot
 */
export type StartupSource = 'runUser' | 'runMachine' | 'runMachine32' | 'folderUser' | 'folderCommon' | 'task'

export interface StartupItem {
  /** Stable id: source + entry name. */
  id: string
  /** What to show: the file description when the program has one, else the entry name. */
  name: string
  source: StartupSource
  /** Registry value name, shortcut file name, or task path + name. */
  entryName: string
  /** The command Windows runs. */
  command: string
  /** The program file the command starts, when it could be worked out. */
  target: string | null
  /** False: the target file no longer exists (an orphaned entry). Null: unknown. */
  targetExists: boolean | null
  publisher: string | null
  enabled: boolean
  /** When it was disabled (from Windows' own record), ms since epoch. */
  disabledAt: number | null
  /** Changing it writes to all users' settings, which needs administrator rights. */
  needsAdmin: boolean
  /** A Microsoft or security product: disabling is allowed but deserves a warning. */
  protectedKind: 'microsoft' | 'security' | null
  /** Human-readable place: a registry key or a folder. */
  location: string
  /** The installed program it belongs to, from the program detector. */
  owner: { id: string; name: string; status: ProgramStatus } | null
}

export interface StartupResult {
  /** False outside Windows. */
  supported: boolean
  items: StartupItem[]
  /** Whether the app runs elevated, so items that need it can be changed. */
  isAdmin: boolean
  durationMs: number
  warnings: string[]
}
