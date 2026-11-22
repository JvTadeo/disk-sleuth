/**
 * Classifier tests on a fixture inventory modeled on a real Windows machine.
 * Run: npm run test:detector
 */
import assert from 'node:assert/strict'
import { classify } from '../src/main/detector/classify'
import { areas, GB, inv, MB, R } from './fixtures/inventory'

const sizes: Record<string, number> = {
  [`${R}\\OldEditor`.toLowerCase()]: 1.4 * GB,
  [`${R}\\TinyLeftover`.toLowerCase()]: 3 * MB,
  [`${R}\\Code`.toLowerCase()]: 900 * MB,
  ['c:\\program files (x86)\\steam']: 2.1 * GB
}

const programs = classify(inv, {
  areas,
  driveRoots: ['C:\\'],
  sizeOf: (p) => sizes[p.toLowerCase()]
})

const by = (name: string) => programs.find((p) => p.name === name)
const st = (name: string) => {
  const p = by(name)
  return p ? `${p.status}/${p.confidence}/${p.reason}` : 'missing'
}

const expect: [string, string][] = [
  ['Steam', 'reg/high/registered'],
  ['Dota 2', 'reg/high/registered'],
  ['Microsoft Visual Studio Code (User)', 'reg/high/registered'],
  ['Node.js', 'reg/high/registered'],
  ['IRPF2025 - Declaração de Ajuste Anual', 'reg/high/registered'],
  ['Java 8 Update 381', 'orphan/high/registryMissingFolder'],
  ['Microsoft Visual C++ 2015-2022 Redistributable (x64)', 'reg/high/registered'],
  ['Windows SDK AddOn', 'reg/high/systemComponent'],
  ['Microsoft.GamingApp', 'reg/high/store'],
  ['Discord', 'reg/high/registered'],
  ['7-Zip', 'unreg/high/noRegistryWithExe'],
  ['Celeste', 'unreg/high/noRegistryWithExe'],
  ['HWiNFO64', 'unreg/high/noRegistryWithExe'],
  ['Spotify', 'unreg/high/noRegistryWithExe'],
  ['OldThing', 'orphan/likely/leftoverFolder'],
  ['OldEditor', 'orphan/likely/leftoverData'],
  // Its uninstaller lives in C:\\Program Files\\WeirdTool, so that folder is claimed by the entry;
  // the broad InstallLocation ("C:\\Program Files") must not claim anything else (7-Zip, OldThing above).
  ['Weird Tool', 'reg/high/registered']
]

let failed = 0
for (const [name, want] of expect) {
  const got = st(name)
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(52)} ${got}${ok ? '' : `   (expected ${want})`}`)
}

// Things that must NOT be reported.
const mustNotList = ['Security Update for Microsoft Office (KB5005000)', 'Fotos', 'TinyLeftover', 'discord', 'Code', 'SteamLibrary', 'Arquivos de Programas RFB', 'Adobe \\ Adobe Photoshop 2021', 'WeirdTool']
for (const n of mustNotList) {
  const ok = !by(n)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  not listed: ${n}${ok ? '' : `  (got ${st(n)})`}`)
}

assert.equal(programs.filter((p) => p.name === 'Steam').length, 1, 'Steam must appear once')
assert.equal(by('Steam')!.size, 2.1 * GB, 'scan size beats registry estimate')
assert.equal(by('Steam')!.sizeSource, 'scan')
assert.equal(by('Node.js')!.location, 'C:\\Program Files\\nodejs', 'location from DisplayIcon')
assert.equal(by('HWiNFO64')!.sources.shortcut, true, 'shortcut detected')
assert.equal(by('Microsoft.WindowsStore')!.hidden, true, 'non-removable store app hidden')
assert.equal(by('Java 8 Update 381')!.canUninstall, false)

console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${expect.length + mustNotList.length} checks passed`)
process.exit(failed ? 1 : 0)
