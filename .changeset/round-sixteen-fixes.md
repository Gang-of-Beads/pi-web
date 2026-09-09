---
"@gang-of-beads/pi-web": patch
---

Round 16 of the convergence review: twelve true findings, ten fixed.

The state rail - the one place the design spends colour on identity - never
painted: its colour rules were written against a borderless element, its
:has() specificity silently outranked every row-state rule, and the session
list's state vocabulary was never named to it. The rail now colours the row,
holds class specificity so selected and archived win over work states, and
speaks both vocabularies.

Also: bulk-selected rows finally look selected (their one style was written
against the same borderless element); a failure banner can no longer be erased
by an unrelated successful request, because the retired-by half travels with
the text again; a settings route restored from the URL actually loads its
panel; the workspace menu's copy button meets the coarse floor; the machines
list retires its search query when hidden like its sibling lists; and the
box-model guard's second shape - which had been silently passing because it
pushed nothing - now reports, and caught two real offenders on its first
talkative run.
