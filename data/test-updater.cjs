'use strict'

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const updaterPath = path.join(__dirname, '..', 'electron', 'updater.cjs')
const src = fs.readFileSync(updaterPath, 'utf8')

function extract(name) {
  const match = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`))
  assert(match, `could not extract ${name} from updater.cjs`)
  return match[0].replace(`function ${name}`, `function ${name}`)
}

const compare = new Function(`${extract('compare')}; return compare;`)()
const changelogLines = new Function(`${extract('changelogLines')}; return changelogLines;`)()

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`)
}

console.log('version compare, in the order check() actually calls it: compare(latest, from)')
check('latest newer -> update', compare('0.3.0', '0.2.0'), 1)
check('latest older -> no update', compare('0.2.0', '0.3.0'), -1)
check('same version', compare('1.0.0', '1.0.0'), 0)
check('numeric not lexical (0.10 > 0.9)', compare('0.10.0', '0.9.0'), 1)
check('missing patch counts as 0, so 1.2.3 is newer than 1.2', compare('1.2.3', '1.2'), 1)
check('equal when one side omits a trailing zero', compare('1.2.0', '1.2'), 0)
check('major bump wins', compare('2.0.0', '1.9.9'), 1)

console.log('changelog parsing')
check('plain bullets', changelogLines('- one\n- two').length, 2)
check('strips bullet marker', changelogLines('- one')[0], 'one')
check('strips star marker', changelogLines('* one')[0], 'one')
check('indented bullet', changelogLines('  - one')[0], 'one')
check('drops blank lines', changelogLines('\n\n- a\n\n- b\n').length, 2)
check('drops headings', changelogLines('## Title\n- a').length, 1)
check('empty body is safe', changelogLines('').length, 0)
check('null body is safe', changelogLines(null).length, 0)
check('caps at 12 lines', changelogLines(Array.from({ length: 40 }, (_, i) => `- line ${i}`).join('\n')).length, 12)

console.log('module surface')
const updater = require(updaterPath)
check('exports register', typeof updater.register, 'function')
check('exports check', typeof updater.check, 'function')
check('exports currentVersion', typeof updater.currentVersion, 'function')
check('downloads url points at own repo', updater.DOWNLOADS, 'https://github.com/StarRiftProject/RiFT-Optimizer/releases/latest')
check('currentVersion matches package.json', updater.currentVersion(), require(path.join(__dirname, '..', 'package.json')).version)

console.log(failures === 0 ? '\nALL UPDATER TESTS PASS' : `\n${failures} UPDATER TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)