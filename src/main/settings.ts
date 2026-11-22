import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { THEME_SOURCES, type ThemeSource } from '@shared/ipc'

export interface Settings {
  theme: ThemeSource
}

const DEFAULTS: Settings = { theme: 'system' }

const file = (): string => join(app.getPath('userData'), 'settings.json')

let current: Settings = DEFAULTS

/** Reads settings once at startup. The file is tiny: a sync read is cheaper than scheduling async I/O. */
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>
    current = {
      theme: THEME_SOURCES.includes(raw.theme as ThemeSource) ? (raw.theme as ThemeSource) : DEFAULTS.theme
    }
  } catch {
    current = { ...DEFAULTS }
  }
  return current
}

export function getSettings(): Settings {
  return current
}

let pending: Promise<void> = Promise.resolve()

/** Saves without blocking the main process; writes are serialized so the file never gets corrupted. */
export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch }
  const snapshot = JSON.stringify(current, null, 2)
  pending = pending
    .then(async () => {
      await mkdir(dirname(file()), { recursive: true })
      await writeFile(file(), snapshot, 'utf8')
    })
    .catch((err) => console.error('[settings] failed to save', err))
  return current
}
