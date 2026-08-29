---
"@vincenthanxiaodu/pi-web": patch
---

An extension asking for an interface PI WEB cannot draw is told out loud. The headless default resolved ui.custom to undefined without a word, so an extension waiting on an answer believed the user chose nothing — the updater's version prompt asked again at every session start, and nobody could see why. The cancellation stays; the browser now gets a persisted warning naming the surface, once per session.
