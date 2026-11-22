/**
 * Fixture inventory modeled on a real Windows machine (paths, registry quirks, leftovers).
 */
import type { Areas, Inventory } from '../../src/main/detector/inventory'

export const U = 'C:\\Users\\voce'
export const L = `${U}\\AppData\\Local`
export const R = `${U}\\AppData\\Roaming`
export const GB = 1024 ** 3
export const MB = 1024 ** 2

export const inv: Inventory = {
  warnings: [],
  registry: [
    // Normal registered program, in both views (must appear once).
    { key: 'Steam', view: '32', name: 'Steam', publisher: 'Valve Corporation', installLocation: 'C:\\Program Files (x86)\\Steam', locationExists: true, uninstallString: '"C:\\Program Files (x86)\\Steam\\uninstall.exe"', uninstallExe: 'C:\\Program Files (x86)\\Steam\\uninstall.exe', uninstallExeExists: true },
    { key: 'Steam App 570', view: '64', name: 'Dota 2', publisher: 'Valve', installLocation: 'C:\\Games\\SteamLibrary\\steamapps\\common\\dota 2 beta', locationExists: true, uninstallString: '"C:\\Program Files (x86)\\Steam\\steam.exe" steam://uninstall/570', uninstallExe: 'C:\\Program Files (x86)\\Steam\\steam.exe', uninstallExeExists: true },
    { key: '{VSCODE}_is1', view: 'user', name: 'Microsoft Visual Studio Code (User)', publisher: 'Microsoft Corporation', version: '1.106.2', installLocation: `${L}\\Programs\\Microsoft VS Code`, locationExists: true, uninstallString: `"${L}\\Programs\\Microsoft VS Code\\unins000.exe"`, uninstallExe: `${L}\\Programs\\Microsoft VS Code\\unins000.exe`, uninstallExeExists: true },
    // MSI program without InstallLocation, found via DisplayIcon.
    { key: '{NODE}', view: '64', name: 'Node.js', publisher: 'Node.js Foundation', version: '24.11.0', uninstallString: 'MsiExec.exe /X{NODE}', displayIcon: 'C:\\Program Files\\nodejs\\node.exe', iconExe: 'C:\\Program Files\\nodejs\\node.exe', iconExeExists: true },
    // IRPF installed outside Program Files.
    { key: 'IRPF2025', view: '32', name: 'IRPF2025 - Declaração de Ajuste Anual', publisher: 'Receita Federal do Brasil', installLocation: 'C:\\Arquivos de Programas RFB\\IRPF2025', locationExists: true, uninstallString: '"C:\\Arquivos de Programas RFB\\IRPF2025\\Desinstalar IRPF2025.exe"' },
    // Entry whose folder and uninstaller are gone: orphan.
    { key: '{JAVA8}', view: '64', name: 'Java 8 Update 381', publisher: 'Oracle Corporation', version: '8.0.3810', installLocation: 'C:\\Program Files\\Java\\jre-1.8', locationExists: false, uninstallString: 'MsiExec.exe /X{JAVA8}' },
    // MSI entry with no location info at all: cannot judge, stays registered.
    { key: '{RUNTIME}', view: '64', name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', publisher: 'Microsoft Corporation', uninstallString: 'MsiExec.exe /X{RUNTIME}' },
    // System component: registered but hidden.
    { key: '{SDK}', view: '64', name: 'Windows SDK AddOn', systemComponent: true, uninstallString: 'MsiExec.exe /X{SDK}' },
    // Update entry: skipped.
    { key: 'KB5005', view: '64', name: 'Security Update for Microsoft Office (KB5005000)', parentKeyName: 'Office16', uninstallString: 'x' },
    // Bad entry pointing at Program Files itself: must not claim every folder there.
    { key: 'BadApp', view: '64', name: 'Weird Tool', installLocation: 'C:\\Program Files', locationExists: true, uninstallString: '"C:\\Program Files\\WeirdTool\\u.exe"', uninstallExe: 'C:\\Program Files\\WeirdTool\\u.exe', uninstallExeExists: true },
    { key: 'Discord', view: 'user', name: 'Discord', publisher: 'Discord Inc.', installLocation: `${L}\\Discord`, locationExists: true, uninstallString: `"${L}\\Discord\\Update.exe" --uninstall`, uninstallExe: `${L}\\Discord\\Update.exe`, uninstallExeExists: true },
    { key: 'Adobe Acrobat', view: '64', name: 'Adobe Acrobat (64-bit)', publisher: 'Adobe', installLocation: 'C:\\Program Files\\Adobe\\Acrobat DC', locationExists: true, uninstallString: 'MsiExec.exe /I{AC76}' }
  ],
  appx: [
    { name: 'Microsoft.GamingApp', packageFullName: 'Microsoft.GamingApp_2511.1001.17.0_x64__8wekyb3d8bbwe', publisher: 'Microsoft Corporation', version: '2511.1001.17.0', installLocation: 'C:\\Program Files\\WindowsApps\\Microsoft.GamingApp_2511' },
    { name: 'Microsoft.WindowsStore', packageFullName: 'Microsoft.WindowsStore_x', nonRemovable: true }
  ],
  shortcuts: [
    { name: 'HWiNFO64', target: 'C:\\Tools\\HWiNFO\\HWiNFO64.exe' },
    { name: 'Visual Studio Code', target: `${L}\\Programs\\Microsoft VS Code\\Code.exe` }
  ],
  folders: [
    { path: 'C:\\Program Files (x86)\\Steam', name: 'Steam', area: 'programFilesX86', exes: ['steam.exe'] },
    { path: 'C:\\Program Files\\nodejs', name: 'nodejs', area: 'programFiles', exes: ['node.exe'] },
    { path: 'C:\\Program Files\\Adobe\\Acrobat DC', name: 'Acrobat DC', area: 'programFiles', container: 'Adobe', exes: ['Acrobat.exe'] },
    { path: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2021', name: 'Adobe Photoshop 2021', area: 'programFiles', container: 'Adobe', exes: [] },
    { path: 'C:\\Program Files\\WeirdTool', name: 'WeirdTool', area: 'programFiles', exes: ['weird.exe'] },
    { path: 'C:\\Program Files\\OldThing', name: 'OldThing', area: 'programFiles', exes: [] },
    { path: 'C:\\Program Files\\7-Zip', name: '7-Zip', area: 'programFiles', exes: ['7zFM.exe'] },
    { path: `${L}\\Programs\\Microsoft VS Code`, name: 'Microsoft VS Code', area: 'localPrograms', exes: ['Code.exe'] },
    { path: 'C:\\Games\\SteamLibrary', name: 'SteamLibrary', area: 'driveRoot', container: 'Games', exes: [] },
    { path: 'C:\\Games\\Celeste', name: 'Celeste', area: 'driveRoot', container: 'Games', exes: ['Celeste.exe'] },
    { path: 'C:\\Arquivos de Programas RFB', name: 'Arquivos de Programas RFB', area: 'driveRoot', exes: [] },
    { path: 'C:\\Tools\\HWiNFO', name: 'HWiNFO', area: 'driveRoot', container: 'Tools', exes: ['HWiNFO64.exe'] },
    { path: 'C:\\Fotos', name: 'Fotos', area: 'driveRoot', exes: [] },
    { path: `${L}\\Discord`, name: 'Discord', area: 'appDataLocal', exes: ['Discord.exe'] },
    { path: `${R}\\discord`, name: 'discord', area: 'appDataRoaming', exes: [] },
    { path: `${R}\\Code`, name: 'Code', area: 'appDataRoaming', exes: [] },
    { path: `${R}\\OldEditor`, name: 'OldEditor', area: 'appDataRoaming', exes: [] },
    { path: `${R}\\TinyLeftover`, name: 'TinyLeftover', area: 'appDataRoaming', exes: [] },
    { path: `${L}\\Spotify`, name: 'Spotify', area: 'appDataLocal', exes: ['Spotify.exe'] }
  ]
}

export const areas: Areas = {
  programFiles: 'C:\\Program Files',
  programFilesX86: 'C:\\Program Files (x86)',
  localPrograms: `${L}\\Programs`,
  appDataLocal: L,
  appDataRoaming: R,
  programData: 'C:\\ProgramData',
  systemRoot: 'C:\\Windows',
  userProfile: U
}
