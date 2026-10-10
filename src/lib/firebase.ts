import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithRedirect,
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

// Without an explicit persistence setting the session lives in memory, so every
// page load starts signed out - including the load that comes back from the
// provider, which is exactly when we still need to be logged in. Local storage
// is kept in the app's own profile directory and survives restarts.
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('could not enable auth persistence:', error)
})

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

// Chromium inside Electron refuses the popup window Firebase wants to open, and
// it reports that as auth/popup-blocked no matter how the click was wired. A
// full redirect works: the window leaves for Google and comes back to our own
// origin, which the navigation guard in the main process allows through.
export async function signInWith(_id: AuthProviderId): Promise<Account> {
  await signInWithRedirect(auth, providerFor('google.com'))
  // the page is going away; the session is picked up by currentAccount on return
  throw new Error('redirecting')
}

// called once on startup, before anything renders, so a session that came back
// from the provider is recognised without a round trip to the user
export async function consumeRedirect(): Promise<Account | null> {
  // the session has to be on disk before we look for one, or a restored login
  // is missed and the gate shows to someone who is already signed in
  await persistenceReady
  try {
    const result = await getRedirectResult(auth)
    if (result?.user) return toAccount(result.user)
  } catch {
    /* no redirect in progress, which is the normal case */
  }
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