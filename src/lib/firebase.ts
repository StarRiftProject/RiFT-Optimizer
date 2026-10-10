import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth'

// Firebase's web config is designed to ship inside client apps: it identifies
// the project, it does not authorise anything. Real access is decided by the
// project's security rules, which live in the Firebase console.
const firebaseConfig = {
  apiKey: 'AIzaSyAJC_Y8-imEZoSggHklfEa_xEg6kXjCJwc',
  authDomain: 'starrift-project.firebaseapp.com',
  projectId: 'starrift-project',
  storageBucket: 'starrift-project.firebasestorage.app',
  messagingSenderId: '463455537780',
  appId: '1:463455537780:web:a6ae79d1053a827caadf21',
  measurementId: 'G-HQ9WLG9PWG',
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)

// Keep the account in this app's own profile directory, and finish restoring it
// before exposing either the login button or the signed-out state.
const persistenceReady = setPersistence(auth, browserLocalPersistence)

export type AuthProviderId = 'google.com'

export type Account = {
  uid: string
  email: string | null
  displayName: string | null
  photoUrl: string | null
  provider: AuthProviderId | 'unknown'
  signInAt: string
}

// Google is the only provider in this build. Apple needs a paid developer
// account and a Services ID before it will work, and Discord was never
// available through Firebase at all, so shipping buttons for either one would
// only ever produce an error.
const PROVIDERS: { id: AuthProviderId; label: string }[] = [
  { id: 'google.com', label: 'Google' },
]

function providerFor() {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return provider
}

// We keep only what identifies the account. No password ever reaches this app,
// and no refresh token is written to disk by our code.
function toAccount(user: {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  providerData: { providerId: string }[]
}): Account {
  const known: string[] = PROVIDERS.map((entry) => entry.id)
  const provider = user.providerData?.[0]?.providerId ?? 'unknown'
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoUrl: user.photoURL,
    provider: (known.includes(provider) ? provider : 'unknown') as Account['provider'],
    signInAt: new Date().toISOString(),
  }
}

export const availableProviders = PROVIDERS

// The app runs on a local loopback origin while Firebase's sign-in helper is on
// firebaseapp.com. Redirect sign-in relies on cross-site storage between those
// origins, which Chromium can block and then silently return to the login gate.
// A Google popup avoids that redirect storage hand-off. prepareAuth is completed
// before the button is enabled, so this call opens its window in the click's
// original user gesture.
export async function signInWith(_id: AuthProviderId): Promise<Account> {
  const result = await signInWithPopup(auth, providerFor())
  return toAccount(result.user)
}

export async function prepareAuth(): Promise<void> {
  await persistenceReady
  await auth.authStateReady()
}

// Called before the login gate decides whether an account is already saved.
export async function restoreAccount(): Promise<Account | null> {
  await prepareAuth()
  return currentAccount()
}

export async function currentAccount(): Promise<Account | null> {
  if (!auth.currentUser) return null
  return toAccount(auth.currentUser)
}

export function watchAccount(listener: (account: Account | null) => void): () => void {
  return onAuthStateChanged(auth, (user) => listener(user ? toAccount(user) : null))
}

export async function signOutAccount(): Promise<void> {
  await signOut(auth)
}
