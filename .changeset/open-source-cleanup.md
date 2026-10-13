---
"@gang-of-beads/pi-web": patch
---

Remove the "pi-web update available" banner and the git-checkout self-update behind it, which only worked for one maintainer's setup. A machine updates from the Updates page or through a configured update command; a git checkout updates by pulling and restarting. Installed services no longer record `PI_WEB_UPDATE_REPO`.
