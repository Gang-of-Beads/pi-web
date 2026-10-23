---
"@gang-of-beads/pi-web": patch
---

PI WEB now runs sessions on Pi 1.4 and needs Pi Coding Agent 1.4.0 or newer. With it, a session opened again, or moved in its session tree, gets the tools of extensions installed after it started; a session keeps working after pi recovers from a reply cut off at the model's output limit; and compaction and branch summaries no longer fail when the model reasons at length. Pi's `codemode` tool now waits up to a minute for a free worker instead of failing, and every session on the machine shares the workers: `PI_CODEMODE_MAX_WORKERS` in the session daemon's environment raises the limit of two. Restart the session daemon and the web service, and reload open pages.
