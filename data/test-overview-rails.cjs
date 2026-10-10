'use strict'

// Guards the rails against the two failures that are invisible until someone
// looks at the screen: a sparkline tone that names a colour variable the
// stylesheet never defines, and a rail that reads data it was not handed.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const rails = fs.readFileSync(path.join(root, 'src', 'components', 'overview-rails.tsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src', 'styles', 'app.css'), 'utf8')
const ui = fs.readFileSync(path.join(root, 'src', 'routes', 'index.tsx'), 'utf8')

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`)
}

console.log('every sparkline tone is a colour the stylesheet defines')
const tones = [...rails.matchAll(/tone="([a-z0-9-]+)"/g)].map((m) => m[1])
check('at least three tones in use', tones.length >= 3, true)
check('tones are unique', new Set(tones).size, tones.length)
for (const tone of tones) {
  const defined = new RegExp(`--${tone}\\s*:`).test(css)
  check(`--${tone} is defined`, defined, true)
}

console.log('the rails are wired to real data')
check('left rail takes history', /history=\{props\.history\}/.test(ui), true)
check('left rail takes the device', /device=\{props\.device\}/.test(ui), true)
check('left rail takes the benchmark', /bench=\{props\.bench\}/.test(ui), true)
check('right rail takes the version', /version=\{props\.version\}/.test(ui), true)
check('rails wrap the console', /className="overview-layout"/.test(ui), true)
check('both rails rendered', /<LeftRail/.test(ui) && /<RightRail/.test(ui), true)

console.log('honest about unmeasured numbers')
check('fps shows a dash until measured', /measured \?\? '—'/.test(rails), true)
check('fps bar reads zero until measured', /: '0%'/.test(rails), true)
check('says so when a figure is not measured', /run MEASURE for a real rate/.test(rails), true)
check('no hardcoded fps anywhere in the rails', !/\b117\b/.test(rails), true)

console.log('layout')
check('three column grid', /grid-template-columns:\s*206px minmax\(0,1fr\) 232px/.test(css), true)
check('collapses to one column on small screens', /max-width:1120px/.test(css), true)
check('sparkline has a size', /\.rail-spark\{width:100%;height:34px/.test(css), true)

assert(failures === 0, `${failures} check(s) failed`)
console.log('\nOVERVIEW RAILS VERIFIED')