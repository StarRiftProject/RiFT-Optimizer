'use strict'

// Guards against the tag casing problem we actually hit: a release published as
// V0.2.1 instead of v0.2.1. The parser must tolerate either.
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'updater.cjs'), 'utf8')
const compare = new Function(`${src.match(/function compare[\s\S]*?\n}/)[0]}; return compare;`)()

// this calls the real normaliseTag, not a copy of it
const parseTag = new Function(
  `${src.match(/function normaliseTag[\s\S]*?\n}/)[0]}; return normaliseTag;`,
)()

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`)
}

console.log('tag parsing')
check('lowercase v is stripped', parseTag('v0.2.1'), '0.2.1')
check('uppercase V is stripped', parseTag('V0.2.1'), '0.2.1')
check('no prefix is fine', parseTag('0.2.1'), '0.2.1')
check('empty tag is safe', parseTag(''), '0.0.0')

console.log('the published release, as installed users will see it')
const from = require(path.join(__dirname, '..', 'package.json')).version
for (const tag of ['v0.2.1', 'V0.2.1']) {
  const latest = parseTag(tag)
  check(`${tag} -> ${latest} is an update from ${from}`, compare(latest, from) > 0, true)
}

assert(failures === 0, `${failures} check(s) failed`)
console.log('\nTAG CASING HANDLED')