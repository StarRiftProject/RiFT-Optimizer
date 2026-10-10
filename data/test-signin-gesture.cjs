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
for (const code of ['auth/operation-not-allowed', 'auth/unauthorized-domain', 'auth/network-request-failed']) {
  check(`surfaces ${code}`, ui.includes(code), true)
}
check('reads the error code off the thrown object', /'code' in caught/.test(ui), true)

console.log('the session survives a reload')
check('persistence is enabled', /setPersistence\(auth, browserLocalPersistence\)/.test(fb), true)
check('browser local persistence imported', /browserLocalPersistence/.test(fb), true)
check('lookup waits for persistence', /await persistenceReady/.test(fb), true)
check('persistence is awaited before the redirect result is read', (() => {
  // the bare import at the top of the file would match too, so look at the
  // call site inside consumeRedirect only
  const body = fb.slice(fb.indexOf('export async function consumeRedirect'))
  const p = body.indexOf('await persistenceReady')
  const g = body.indexOf('getRedirectResult(auth)')
  return p >= 0 && p < g
})(), true)
check('nothing signs the user out in-app', /signOutAccount\(/.test(ui), false)

console.log('redirect, not popup')
check('uses signInWithRedirect', /signInWithRedirect/.test(fb), true)
check('no signInWithPopup anywhere', /signInWithPopup/.test(fb), false)
check('reads the redirect result on return', /getRedirectResult/.test(fb), true)
check('gate consumes the redirect result', /consumeRedirect/.test(ui), true)

console.log('the navigation guard lets the provider through')
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const guard = main.match(/will-navigate'[\s\S]*?\n\s*\}\)/)
check('guard exists', Boolean(guard), true)
if (guard) {
  check('own origin still allowed', /target\.origin === ownOrigin/.test(guard[0]), true)
  check('auth hosts allowed through', /isAuthHost/.test(guard[0]), true)
  check('firebase domains allowed through', /firebaseapp\.com/.test(guard[0]), true)
  check('everything else still refused', /preventDefault/.test(guard[0]), true)
}

assert(failures === 0, `${failures} check(s) failed`)
console.log('\nSIGN-IN FLOW VERIFIED')