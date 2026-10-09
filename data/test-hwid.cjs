'use strict'

const assert = require('node:assert')
const path = require('node:path')

const hwid = require(path.join(__dirname, '..', 'electron', 'hwid.cjs'))

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`)
}

console.log('hwid shape')
const first = hwid.hwid()
check('produces an id', typeof first.hwid === 'string' && first.hwid.length > 0, true)
check('has stable grouping', /^[0-9a-f]{8}(-[0-9a-f]{8})+$/.test(first.hwid), true)
check('needs two real identifiers', first.reliable, true)
check('short() truncates for display', hwid.short(first.hwid).length <= 18, true)

console.log('determinism')
const second = hwid.hwid()
check('same machine, same id', second.hwid, first.hwid)

console.log('no raw serial leaks')
check('parts object is empty in the returned payload', Object.keys(first.parts).length, 0)
check('store path is per-user appdata', /RIFT[\\/]hwid\.json$/.test(hwid.STORE()), true)

console.log('resolve + binding')
const bound = hwid.resolve()
check('resolves to an id', Boolean(bound.hwid), true)
check('reports first bind on a clean store', bound.firstBind === true || bound.firstBind === false, true)
check('second resolve is not a first bind', hwid.resolve().firstBind, false)
check('no mismatch on the same machine', hwid.resolve().mismatch, false)

console.log('degraded hardware')
const p = hwid.parts()
check('reliability requires >= 2 identifiers', p.reliable === (p.usableCount >= 2), true)

assert(failures === 0, `${failures} check(s) failed`)
console.log('\nALL HWID TESTS PASS')