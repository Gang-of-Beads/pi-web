---
"@gang-of-beads/pi-web": patch
---

Git's review mode is reachable again on desktop. Git now draws its own Expand key at the end of its toolbar; it opens every changed file's diff in one scroll across the whole window, and the same key reads Exit expanded there. A remembered or shared link that says a page is expanded no longer hides the app bar for a page that cannot expand, and opening another page gives the window back.

Git shows its branch and ahead and behind counts (`main · ↑2 ↓1`) at the end of its toolbar, and Git and Files say "out of date" there while their list predates a change, beside the Refresh that clears it.

For plugin authors: a workspace panel declares `fullscreen: true` to be allowed the whole window, and draws its own enter and exit controls using the new optional `host.workspacePanelFullscreenAvailable()`. PI WEB no longer draws `summary`.

A browser reload is enough.
