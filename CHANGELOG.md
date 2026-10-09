# Changelog

Everything below the newest heading is what the in-app update popup shows.
Keep one bullet per change, phrased for someone who is not a developer.

## 0.2.1

* Sign-in window now opens correctly instead of being blocked
* Machine id is generated locally and never leaves the PC in plain text
* Release tags are read correctly whether written `v0.2.1`, `V0.2.1` or `0.2.1`
* Discord sign-in removed, it was never available through Firebase
* `npm run release` publishes a tagged build and its notes in one command

## 0.2.0

* Update popup: shows the new version and what changed, pinned to our own release feed
* Machine binding: one licence per PC, hashed locally
* Sign-in screen with Google and Apple
* Fixed the packaging crash caused by converting a 399 KB icon at build time
* Game frame target moved to 240, display stays pinned to the real panel rate
* Version badge in the sidebar, with a marker when an update is waiting