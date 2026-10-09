'use strict'

// Guards the reason sign-in kept failing: chromium only allows window.open
// during a user gesture, so nothing may await before Firebase opens the popup.
// This checks the shipped source rather than trusting a code review.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const ui = fs.readFileSync(path.join(root, 'src', 'routes', 'index.tsx'), 'utf8')
const fb = fs.readFileSync(path.join(root, 'src', 'lib', 'firebase.ts'), 'utf8')

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`)
}

console.log('the click handler')
const begin = ui.match(/const begin = useCallback\(([\s\S]*?)\n\s*\[onSignedIn\]/)
check('begin callback found', Boolean(begin), true)
const body = begin ? begin[1] : ''

check('no dynamic import inside the click handler', /import\(/.test(body), false)
check('reads the preloaded fn from the ref', /signInRef\.current/.test(body), true)

// the ref read must happen before the call, and nothing may await in between
const refAt = body.indexOf('signInRef.current')
const setBusyAt = body.indexOf('setBusy')
const callAt = body.search(/await signIn\(/)
check('ref is read first', refAt >= 0 && refAt < callAt, true)
check('setBusy comes after the ref read', setBusyAt > refAt, true)
check('nothing awaits before the popup opens', body.slice(0, callAt).includes('await'), false)

console.log('the ref is filled ahead of the click')
check('module is imported in an effect', /import\('\.\.\/lib\/firebase'\)/.test(ui), true)
check('the ref is assigned from the module', /signInRef\.current = mod\.signIn/.test(ui), true)
check('SignInGate declares the ref', /const signInRef = useRef/.test(ui), true)

console.log('google only')
check('provider list is google alone', /const providers = \[\{ id: 'google\.com' as const, label: 'Google', mark: 'G' \}\]/.test(ui), true)
check('no apple button', /apple\.com/.test(ui), false)
check('no literal apple label', /label: 'Apple'/.test(ui), false)
check('firebase type is google only', /export type AuthProviderId = 'google\.com'/.test(fb), true)
check('no discord or apple provider entries', /discord\.com|apple\.com/.test(fb), false)

console.log('errors name their cause')
for (const code of ['auth/popup-blocked', 'auth/operation-not-allowed', 'auth/unauthorized-domain']) {
  check(`surfaces ${code}`, ui.includes(code), true)
}
check('reads the error code off the thrown object', /'code' in caught/.test(ui), true)

assert(failures === 0, `${failures} check(s) failed`)
console.log('\nSIGN-IN GESTURE HANDLING VERIFIED')