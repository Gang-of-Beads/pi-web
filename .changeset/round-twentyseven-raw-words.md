---
"@gang-of-beads/pi-web": patch
---

A link failure keeps the browser's own words, and onopen stops retiring
claims it cannot prove.

The plugin-backend wrapper prefixed "Plugin backend request unavailable:"
onto the browser's "Failed to fetch", which the anchored transport rules
match whole-message - so a dropped connection became a permanent red banner
that survived every poll on every machine. The wrapper now throws the raw
text, keeping the failure's transport lifetime and machine scope, and the
two direct fetch legs stamp the machine they were talking to so the
commonest link failure is no longer page-scoped. The realtime socket's
onopen no longer retires claims: the proxies accept the upgrade before
bridging upstream, so onopen proved the web process alive while the daemon
was down, retracting the banner half a second after raising it. Also: the
dead live-link parameter is gone, a third-party manifest no longer vouches
for PI WEB's link, the hold window and expiry timer reset the whole
schedule marker pair, and the updates panel, the workspace trust row and
ProjectList's retry button take the 44px coarse floor.
