'use strict'

// Re-checks the two areas the first harness reported as failures, using the
// exact call shape the app uses, so we can tell a real bug from a bad test.
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'updater.cjs'), 'utf8')
const compare = new Function(`${src.match(/function compare[\s\S]*?\n}/)[0]}; return compare;`)()

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`)
}

console.log('compare() argument order, as updater.check() actually calls it')
// check() does: compare(latest, from) > 0  => update
check('latest 0.3.0 vs from 0.2.0 -> update', compare('0.3.0', '0.2.0'), 1)
check('latest 0.2.0 vs from 0.3.0 -> no update', compare('0.2.0', '0.3.0'), -1)
check('latest 0.10.0 vs from 0.9.0 -> update', compare('0.10.0', '0.9.0'), 1)

console.log('bullet stripping happens in changelogLines after the line is trimmed')
const changelogLines = new Function(`${src.match(/function changelogLines[\s\S]*?\n}/)[0]}; return changelogLines;`)()
check('dash bullet', changelogLines('- one')[0], 'one')
check('star bullet', changelogLines('* one')[0], 'one')
check('indented bullet', changelogLines('  - one')[0], 'one')
check('plus bullet', changelogLines('+ one')[0], 'one')
check('markdown heading dropped', changelogLines('## Title\n- one').length, 1)
check('plain text untouched', changelogLines('something else')[0], 'something else')
check('mixed body is clean', changelogLines('  - one\n* two\n## Head\n+ three').join(','), 'one,two,three')

console.log('padding behaviour')
check('trailing v is stripped before compare', 'v0.3.0'.replace(/^v/, ''), '0.3.0')

assert(failures === 0, `${failures} check(s) failed`)
console.log('\nRECHECK PASS')