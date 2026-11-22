/**
 * Startup manager tests: the StartupApproved format, reading program paths out of startup commands, and linking
 * entries to installed programs. Pure functions only, so they run on any OS.
 * Run: npm run test:detector (runs these after the classifier tests)
 */
import assert from 'node:assert/strict'
import type { Program } from '../src/shared/programs'
import {
  approvedState,
  approvedValue,
  exeFromStartupCommand,
  expandEnv,
  needsAdmin,
  ownerOf,
  protectedKindOf
} from '../src/main/startup/parse'

let checks = 0
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg)
  checks++
}
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.equal(a, b, msg)
  checks++
}

// ---------- StartupApproved ----------
eq(approvedState(undefined).enabled, true, 'no record: enabled')
eq(approvedState([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).enabled, true, '02: enabled')
eq(approvedState([6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).enabled, true, '06: enabled')
const when = Date.UTC(2026, 10, 22, 12, 0, 0)
const hex = approvedValue(false, when)
eq(hex.length, 24, '12 bytes as hex')
ok(hex.startsWith('03000000'), 'disabled flag first')
const bytes = Array.from(Buffer.from(hex, 'hex'))
const back = approvedState(bytes)
eq(back.enabled, false, '03: disabled')
eq(back.disabledAt, when, 'FILETIME round-trip keeps the time (to the ms)')
eq(approvedValue(true), '020000000000000000000000', 'enabled value has no time')

// ---------- commands ----------
const env = { windir: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\joao\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }
eq(expandEnv('%WINDIR%\\x.exe', env), 'C:\\Windows\\x.exe', 'env names are case-insensitive')
eq(expandEnv('%NOPE%\\x', env), '%NOPE%\\x', 'unknown variables stay')
eq(
  exeFromStartupCommand('"C:\\Users\\joao\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe', env),
  'C:\\Users\\joao\\AppData\\Local\\Discord\\Update.exe',
  'quoted path with arguments'
)
eq(
  exeFromStartupCommand('C:\\Program Files\\Realtek\\Audio\\HDA\\RtkAudUService64.exe -background', env),
  'C:\\Program Files\\Realtek\\Audio\\HDA\\RtkAudUService64.exe',
  'unquoted path with spaces is cut at .exe'
)
eq(exeFromStartupCommand('%windir%\\system32\\SecurityHealthSystray.exe', env), 'C:\\Windows\\system32\\SecurityHealthSystray.exe', 'env expanded')
eq(
  exeFromStartupCommand('rundll32.exe "C:\\Program Files\\Vendor\\helper.dll",Start', env),
  'C:\\Program Files\\Vendor\\helper.dll',
  'rundll32: the DLL it runs'
)
eq(
  exeFromStartupCommand('wscript.exe //B C:\\Scripts\\sync.vbs', env),
  'C:\\Scripts\\sync.vbs',
  'wscript: the script it runs'
)
eq(exeFromStartupCommand('ctfmon.exe', env), 'ctfmon.exe', 'bare name stays bare (resolved later through PATH)')
eq(exeFromStartupCommand('   ', env), null, 'empty command')

// ---------- classification ----------
ok(needsAdmin('runMachine') && needsAdmin('runMachine32') && needsAdmin('folderCommon') && needsAdmin('task'), 'all-users sources need admin')
ok(!needsAdmin('runUser') && !needsAdmin('folderUser'), 'this-user sources do not')
eq(protectedKindOf('Microsoft Corporation', null), 'microsoft', 'Microsoft publisher')
eq(protectedKindOf('Malwarebytes', null), 'security', 'security vendor')
eq(protectedKindOf(null, 'C:\\Windows\\System32\\x.exe', 'C:\\Windows'), 'microsoft', 'file inside Windows')
eq(protectedKindOf('Valve', 'C:\\Program Files (x86)\\Steam\\steam.exe', 'C:\\Windows'), null, 'ordinary program')

const program = (id: string, name: string, location: string, status: Program['status'] = 'reg'): Program => ({
  id,
  name,
  status,
  confidence: 'high',
  kind: 'win32',
  reason: 'registered',
  location,
  sources: { registry: true, store: false, folder: true, shortcut: true },
  hidden: false,
  canUninstall: true,
  canTrash: false
})
const programs = [
  program('steam', 'Steam', 'C:\\Program Files (x86)\\Steam'),
  program('adobe', 'Adobe (restos)', 'C:\\Program Files (x86)\\Common Files\\Adobe', 'orphan'),
  program('adobe-oobe', 'Adobe OOBE', 'C:\\Program Files (x86)\\Common Files\\Adobe\\OOBE')
]
eq(ownerOf('C:\\Program Files (x86)\\Steam\\steam.exe', programs)?.name, 'Steam', 'file inside the program folder')
eq(ownerOf('C:\\Program Files (x86)\\Common Files\\Adobe\\OOBE\\PDApp\\x.exe', programs)?.id, 'adobe-oobe', 'deepest folder wins')
eq(ownerOf('C:\\Program Files (x86)\\SteamTools\\x.exe', programs), null, 'a folder name prefix is not a parent folder')
eq(ownerOf(null, programs), null, 'no target, no owner')

console.log(`All ${checks} startup checks passed`)
