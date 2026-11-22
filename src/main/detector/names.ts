/**
 * Name normalization and the lists of folders that belong to Windows itself.
 * Being conservative here is what keeps the detector from reporting false orphans.
 */

/** "7-Zip 24.08 (x64)" → "7zip", "OBS Studio" → "obsstudio", "Adobe Inc." → "adobe". */
export function norm(s: string | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/\(.*?\)|\[.*?\]/g, ' ') // (x64), [Beta]
    .replace(/\bv?\d+(\.\d+)+\b/g, ' ') // versions: 24.08, v1.2.3
    .replace(/\b(x64|x86|amd64|arm64|64-bit|32-bit|64 bit|32 bit)\b/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|s\.?a\.?|srl|software|technologies|games|studios?)\b\.?/g, ' ')
    .replace(/[^a-z0-9]/g, '')
}

const GENERIC = new Set([
  'app', 'apps', 'bin', 'cache', 'caches', 'common', 'config', 'data', 'files', 'game', 'games', 'logs', 'misc',
  'new', 'old', 'programs', 'settings', 'setup', 'shared', 'software', 'temp', 'tmp', 'tool', 'tools', 'update',
  'updates', 'user', 'users', 'backup', 'downloads', 'install', 'installer', 'launcher', 'portable', 'steamlibrary'
])

/** Names too generic to match a program by name (only path containment counts for them). */
export function isGenericName(name: string): boolean {
  const n = norm(name)
  return n.length < 4 || GENERIC.has(n)
}

/** True when two names plausibly refer to the same program or vendor. */
export function namesMatch(a: string | undefined, b: string | undefined): boolean {
  const x = norm(a)
  const y = norm(b)
  if (x.length < 3 || y.length < 3) return false
  if (x === y) return true
  // One contained in the other, with enough letters to mean something.
  if (x.length >= 4 && y.includes(x)) return true
  if (y.length >= 4 && x.includes(y)) return true
  return false
}

// Folders under Program Files that ship with Windows or are shared by many programs.
export const PROGRAM_FILES_IGNORE = new Set(
  [
    'Common Files', 'WindowsApps', 'ModifiableWindowsApps', 'Windows Defender', 'Windows Defender Advanced Threat Protection',
    'Windows Mail', 'Windows Media Player', 'Windows Multimedia Platform', 'Windows NT', 'Windows Photo Viewer',
    'Windows Portable Devices', 'Windows Security', 'Windows Sidebar', 'WindowsPowerShell', 'Internet Explorer',
    'Microsoft Update Health Tools', 'Uninstall Information', 'Reference Assemblies', 'MSBuild', 'Microsoft.NET',
    'PackageManagement', 'dotnet', 'Microsoft SQL Server Compact Edition', 'Windows Kits', 'Microsoft SDKs',
    'IIS', 'IIS Express', 'Microsoft Analysis Services', 'MSECache', 'Package Cache', 'InstallShield Installation Information'
  ].map((s) => s.toLowerCase())
)

// Top-level folders of a drive that are not programs.
export const DRIVE_ROOT_IGNORE = new Set(
  [
    'Windows', 'Users', 'Program Files', 'Program Files (x86)', 'ProgramData', '$Recycle.Bin', 'System Volume Information',
    'Recovery', 'PerfLogs', 'Documents and Settings', 'Config.Msi', 'MSOCache', 'Windows.old', '$Windows.~BT', '$Windows.~WS',
    '$WinREAgent', '$SysReset', '$GetCurrent', 'OneDriveTemp', 'Intel', 'AMD', 'NVIDIA', 'Drivers', 'inetpub', 'XboxGames',
    'ESD', 'Boot', 'EFI', 'SWSetup', 'temp', 'tmp', 'Recovery Image', 'found.000', 'WpSystem', 'WUDownloadCache'
  ].map((s) => s.toLowerCase())
)

// Folders in AppData / ProgramData that Windows, drivers or developer tools create.
export const DATA_IGNORE = new Set(
  [
    'Microsoft', 'Packages', 'Temp', 'Programs', 'Comms', 'ConnectedDevicesPlatform', 'CrashDumps', 'D3DSCache', 'Publishers',
    'PlaceholderTileLogoFolder', 'VirtualStore', 'IsolatedStorage', 'assembly', 'Apps', 'History', 'Microsoft_Corporation',
    'Package Cache', 'ssh', 'USOShared', 'USOPrivate', 'SoftwareDistribution', 'Windows', 'WindowsHolographicDevices',
    'Desktop', 'Documents', 'Start Menu', 'Templates', 'Application Data', 'Favorites', 'regid.1991-06.com.microsoft',
    'SquirrelTemp', 'NVIDIA', 'NVIDIA Corporation', 'Intel', 'AMD', 'ATI', 'Realtek', 'Dell', 'HP', 'Lenovo', 'ASUS',
    'Downloaded Installations', 'Package Management', 'ToastNotificationManagerCompat', 'CEF', 'fontconfig', 'gtk-3.0',
    'npm', 'npm-cache', 'pnpm', 'pnpm-cache', 'pnpm-state', 'Yarn', 'pip', 'pypoetry', 'uv', 'go-build', 'NuGet', 'node-gyp',
    'electron', 'electron-builder', 'ms-playwright', 'deno', 'bun', 'Composer', 'Sun', 'Oracle', 'Mozilla', 'Google',
    'Microsoft Help', 'MicrosoftEdge', 'Identities', 'Media Center Programs', 'Sync', 'GameDVR', 'IconCache', 'Speech',
    'CrashReportClient', 'cache', 'Caches', 'Logs', 'Crashpad', 'ElevatedDiagnostics', 'PeerDistRepub', 'Ubisoft Game Launcher',
    'Steam', 'Epic', 'EpicGamesLauncher', 'UnrealEngine', 'Unity', 'Battle.net', 'Blizzard Entertainment', 'Riot Games',
    'Origin', 'EA Desktop', 'Electronic Arts', 'Rockstar Games'
  ].map((s) => s.toLowerCase())
)

export function isIgnored(set: Set<string>, name: string): boolean {
  const lower = name.toLowerCase()
  return set.has(lower) || lower.startsWith('regid.') || lower.startsWith('{') || lower.startsWith('.')
}

/** Executables that do not make a folder "a program" (installers and helpers left behind). */
export function isMeaningfulExe(name: string): boolean {
  const n = name.toLowerCase()
  return !/^(unins\d*|uninstall.*|uninst.*|setup.*|install.*|update.*|updater.*|crashpad_handler|crashreporter.*|vc_?redist.*|dxsetup)\.exe$/.test(n)
}
