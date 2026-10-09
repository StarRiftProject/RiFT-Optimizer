import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
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

function providerFor(id: AuthProviderId) {
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

export async function signInWith(id: AuthProviderId): Promise<Account> {
  const result = await signInWithPopup(auth, providerFor(id))
  if (!result.user) throw new Error('no account returned')
  return toAccount(result.user)
}

// Firebase's popup calls window.open, which chromium only permits during a real
// user gesture. Awaiting a dynamic import before that call loses the gesture and
// the browser blocks the popup, so the module is resolved ahead of time and
// handed in by the click handler. Nothing may await before signInWith runs.
export type SignInFn = (id: AuthProviderId) => Promise<Account>

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