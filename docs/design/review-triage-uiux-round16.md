# Round 16 triage: three lanes, not clean

Configuration: same three bllm lanes as round 15 (two glm with split focus,
one qwen full pass) against the fixed HEAD. All three lanes re-verified the
round-15 fixes first: nine for nine still in place.

## Findings and dispositions

### Fixed in this wave

1. **The state rail never painted** (lane C, major). The rail's width lives on
   the row, but two of its colour rules were written against the borderless
   `.action-main`, and the session vocabulary (`.session-state.*`) was never
   named to it - the largest list on screen had no rail at all, and the same
   activity got a green rail on a machine row and nothing on the session row
   beside it. **Fixed**: colour on the row; `:where()` inside `:has()` so the
   rules hold class specificity and the row-state rules can actually override;
   both vocabularies named.
2. **`:has()` specificity silently beat the row-state rules** (lane A,
   medium). Closed by the same `:where()` rewrite: selected, archived and
   unread now win over the work states, consistently in every list.
3. **Bulk-selected's only row style was dead** (lane C, medium) - written
   against the borderless element too. **Fixed** on the row.
4. **Error producers bypass the errorNoticePatch contract** (lane B, major).
   The round-15 banner fix itself planted an unpaired producer; the stale
   retired-by mark then let an unrelated successful request erase a real
   failure from the screen. **Fixed** for the wave-file producer; the
   controller-level producers predate the wave and are recorded below.
5. **A settings route restored from the URL never loaded its module** (lane B,
   low): the route claimed a panel that was not on screen, with no banner.
   **Fixed** - the surface load is announced on the opening, whatever path
   opened it.
6. **The workspace menu's copy button was 18px wide** (lane A, low), under the
   AA floor the repo cites, with no coarse override. **Fixed**: 24px on coarse
   pointers.
7. **The machines list never retired its search query** when hidden (lane C,
   minor), though the other two lists run that rule and document why.
   **Fixed** with the same two lines.
8. **Dead `sending` rail rule** (lane C): no producer inside a row. Removed
   with the claim it carried.
9. **`activity-ring` styled nowhere** (lane C, cosmetic): the unread variant
   keeps its class, the always-empty one is gone. `--pi-rail-width` is now
   declared, closing the drift the parity doc had carried.
10. **boxModelGuard's second shape was a no-op** (lane A, note): `push()`
    with no arguments adds nothing, so the assertion always passed. With real
    diagnostics it immediately caught two genuine offenders
    (CommandPicker options, MachineSwitcher actions panel), both **fixed**.

### Deferred with reasons

- **Section focus contract has two implementations** (lane C, major by
  consequence, reach is phone-with-keyboard): module-level refs break after a
  sheet cycle, and machine sections' `focus` is never called. The repair is a
  plugin-API decision (per-surface refs, or dropping `focus` from the
  contract) - owner track, recorded in surfaces-as-plugins.
- **Controller-level unpaired error producers** (lane B): the sites predate
  this wave; converting them is a mechanical sweep that deserves its own
  commit with a paired-write test at the controller layer.
- **SessionTreeNavigator spacing literals and two guard blind spots** (lane A,
  low): the literals predate the wave; extending the spacing guard to long
  property names and values beyond 24px is a guard change with its own blast
  radius, queued behind the convergence verdict.
- **Round-15 F2 evidence correction** (lane C): the fix was right; the
  recorded evidence claimed a visible symptom that the dead rail could never
  show. This page is the correction.

## Verdict

Round 16 was not clean. The lanes reported fourteen items: ten fixed here
(one of them, the box-model guard, was silently passing and caught two real
offenders on its first talkative run), four deferred with written reasons.
The counting basis: fixed and deferred items are counted individually; a
correction to an earlier round's evidence is noted inside the item it
belongs to, not counted again. The convergence loop continues - round 17 runs
the same configuration against this HEAD.
