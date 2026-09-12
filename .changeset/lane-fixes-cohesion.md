---
"@gang-of-beads/pi-web": patch
---

Review-lane fixes for the cleanup criterion, the recreate path and the
fade rule.

The missing-folder cleanup criterion combined with the idle-day cutoff
in the wrong order: with only the missing-folder checkbox enabled, the
planner archived every non-busy session in scope instead of just the
dead-folder ones - the guards are now independent. The cached-new
session recreate path was the last producer of starts that bypassed the
dead-workspace fail-fast; it now answers with the same one sentence.
The workspace stamp probes statSync().isDirectory() like the session
listing does, and the fade rule loses a stray declaration fragment.
