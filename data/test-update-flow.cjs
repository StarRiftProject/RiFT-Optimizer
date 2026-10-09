'use strict'

// Proves the update flow end to end without touching the network: it swaps the
// real release feed for a local fixture, then checks that check() reports the
// right thing. Same code path the app uses, only the URL changes.
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const real = fs.readFileSync(path.join(root, 'electron', 'updater.cjs'), 'utf8')
const pkgVersion = require(path.join(root, 'package.json')).version

const fixturePath = path.join(__dirname, 'fake-release.json')

// the stub reads the url verbatim, so the fixture path must be a bare windows
// path rather than a file:// url
const stub = [
  'function fetchJson(url) {',
  "  return JSON.parse(require('node:fs').readFileSync(url, 'utf8'))",
  '}',
].join('\n')

const mocked = real
  .replace(/const RELEASES = .*/, `const RELEASES = ${JSON.stringify(fixturePath)}`)
  .replace(/function fetchJson[\s\S]*?\n}\n/, `${stub}\n`)

const mockFile = path.join(root, 'electron', 'updater.fixture.cjs')
fs.writeFileSync(mockFile, mocked, 'utf8')

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`)
}

function fixture(version, notes) {
  fs.writeFileSync(
    path.join(__dirname, 'fake-release.json'),
    JSON.stringify({ tag_name: `v${version}`, body: notes, html_url: 'https://example.invalid/x' }, null, 2),
    'utf8',
  )
  // bust the in-process cache between cases
  delete require.cache[require.resolve(mockFile)]
  return require(mockFile)
}

console.log(`installed version: ${pkgVersion}`)

console.log('a newer tag is offered as an update')
let mod = fixture('0.3.0', '## What changed\n\n* HWID binding\n* Update popup\n* Firebase sign-in')
mod.check().then((r) => {
  check('state', r.state, 'available')
  check('from', r.from, pkgVersion)
  check('to', r.to, '0.3.0')
  check('notes are clean', r.notes, ['HWID binding', 'Update popup', 'Firebase sign-in'])
  check('heading dropped', r.notes.some((n) => n.includes('##')), false)

  console.log('the same version is not an update')
  const same = fixture(pkgVersion, '* nothing')
  return same.check().then((r2) => {
    check('state', r2.state, 'current')
    check('to equals from', r2.to, r2.from)

    console.log('an older tag is never offered')
    const older = fixture('0.0.1', '* old build')
    return older.check().then((r3) => {
      check('state', r3.state, 'current')

      console.log('numeric compare, not lexical')
      const higher = fixture('0.10.0', '* ten')
      return higher.check().then((r4) => {
        check('0.10.0 beats 0.9.x lexically but must still be an update', r4.state, 'available')

        fs.unlinkSync(mockFile)
        assert(failures === 0, `${failures} check(s) failed`)
        console.log('\nUPDATER FLOW VERIFIED AGAINST A FIXTURE')
      })
    })
  })
}).catch((error) => {
  console.error('  fixture run failed:', error.message)
  process.exit(1)
})