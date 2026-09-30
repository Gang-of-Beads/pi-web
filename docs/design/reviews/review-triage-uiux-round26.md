# Round 26 triage: the fix that fixed a flag write, the guard that did not look, and the join nobody owns

Configuration: the same three bllm lanes against the round-25 HEAD. The
round's sharpest finding is about this process itself: lane B showed the
round-25 retraction "fix" moved a flag write above the emptiness check and
left the reader-visible retraction behind the same early return — the
changeset's sentence shipped, the behaviour did not. That is the second
consecutive round where a claim outran its edit on this exact code path,
and the response this round is structural: the decision now lives in one
tested module, not in a callback body.

## Fixed in this wave

1. **The interrupted-runs retraction, actually delivered** (lane B, P1):
   the read's outcome is now a pure plan (failed / adopt markers / resolve
   the unknown banner) with direct tests, and the retraction sits after no
   early return. An empty post-boot read resolves the banner without
   erasing on-screen markers; the write-only flag is gone.
2. **The plugin-backend leg vouches for the machine it holds** (lane B,
   P2): the local prefix carries no /machines/ segment, so the URL rule
   could never scope it — the caller now states target.machineId, and the
   reachability report takes an explicit scope for exactly this case.
3. **The reachability report accepts an explicit scope** (lane B/C): the
   report's vouching comes from the URL when the URL can say it.
4. **The machine status vocabulary joins the rail table** (lane C,
   Medium): offline and error rows wear the danger dot in the plugin and a
   transparent rail in the shell — the scanning edge said nothing about the
   one machine state that matters most. Danger now, placed after unread
   (health outranks unread), with the cross-file join documented.
5. **hoverGuard scans the plugin tree** (lane C, high value): the only CSS
   guard still single-root missed two live bare :hover offences in the git
   panel; both are wrapped in the house (hover: hover) guard and the guard
   now walks both roots like its five siblings.
6. **The banner hold belongs to a context** (lane B, P2/P3): a machine or
   workspace switch no longer replays the previous context's banner for up
   to 1.5s over the place the reader just arrived at.
7. **The cleared claim resets both schedule markers** (lane B, P3): two
   consecutive page-level claims with identical wording now re-arm.
8. **The geometry twins** (lane A): the coarse checkbox centring formula
   names the slot it actually centres in (touch, not comfort — 4px off), and
   the inert placeholder keeps the coarse geometry instead of being
   out-specificed by the (0,2,0) base rule.
9. **Dead code** (lanes B/C): the core activityBadge's twin mappers (the
   plugin copies own that logic), the test-only retiresOnReply predicate in
   the production module, the navigation panel's machineStatusSnapshots
   copy (read only by its own dead method; the binding forced a re-render
   per snapshot write for nothing).
10. **Docs** (lanes A/C): operation-model's "fixed" list no longer claims
    the live-link timeout behaviour its own consequence-2 records as open;
    the capability map's machine rows point at the plugin and the quick
    switcher.

## Adjudicated FALSE (recorded)

- **The session-row-indicator custom element** (lane C claimed a dead
  boot-registering element with a duplicate stylesheet): the file at this
  HEAD is a 72-line module of ranking functions with no customElement, no
  LitElement and no duplicate sheet — the finding does not match the tree.
- Lane A's three suspicions (boxModelGuard max-width shape, the composite
  rail/dot priority matrix, the QuickSwitcher dot centring) are each checked
  and stand clean.

## Deferred with written reason

- **The collapse-toggle chain** (lane C, Medium): the wiring is dead but
  the collapsed state still steers the compact panel, and "none" is
  unreachable. Restore or excise is the owner's section-design call (same
  item as round-25's deferred chain).
- **The quick switcher's fetch race** (lane B, P3): a generation token
  across the loader's async phases is a real fix but the impact is bounded
  (a stale list for ≤30s or until forced refresh). Recorded.
- **pointerQueryOrder's element/grouped-selector grammar** (lane A):
  latent blind spots with no current offence; recorded.
- **Local plugin-backend traffic and the mixed local namespace** (lane C
  F8): the explicit-scope report fixes the caller; the general
  local-namespace vocabulary question stays with the owner (round-24 item).
