# Goal Round B triage: the re-review that caught the fixer

Configuration: three glm lanes re-reviewed the Round A fix wave on the live
stack - every Round A claim was re-measured at pixel level.

## Verification verdict (Round A claims vs the reader)

**8 of 9 fixes reached the reader**: border contrast (1.79:1 live), fold
button radius + breathing (2/3px, was 0/1), heading distribution (uniform
25.9 phone / 9.6 desktop), column edges (nav column one edge at both
widths), quick-switcher create-tile centering, Files toolbar floor (44px
live), tile edge, heading rhythm (4px everywhere incl. the sheet), Tasks
title. **Two claims failed verification** and are fixed properly this wave:

- **The new-session empty state never centered**: `margin: auto` in a
  block-formatting scroller resolves to 0 vertically - the triage claimed
  what the CSS intended, not what the reader sees. Fixed with
  `min-height: 100%` (fills the scroller; the existing centering then
  works), verified by two lanes' shared mechanism note.
- **tasks/relays dashed empty states**: same no-op - `margin: auto` inside
  a non-flex viewer with a content-sized grid row. The viewers now fill
  their panels (tasks gained flex column; relays' align-content start →
  stretch), so the auto margins center for real.

## Regression caught (the fixer's own)

The Round A settings-controls height pin clamped EVERY button - including
the ~180px Appearance theme cards, which collapsed to 32/44px and overlapped
across three breakpoints (the "P0" both lanes re-flagged). Buttons return to
min-height; inputs and selects keep the pinned height (the original C1
select-vs-input mismatch stays fixed).

## Also fixed (Round B findings)

- **Pressed states**: 5 more borderless touch producers (compact-scope,
  compact-session, compact-header-action, context-bar buttons, quick
  switcher close, drawer tabs) - the family is now complete per lane B's
  stylesheet scan.
- **actions-row** joins the header's reading-edge (the fold-expand jump
  10↔6 is gone).
- **Extension card buttons** get a boundary: they sat darker than the
  raised card they live on (inverted contrast, 1.11:1).
- **Message-header dividers**: the 35%-alpha color-mix dividers measured
  1.03:1 after the border lift - solid muted border instead (one rule per
  role block).

## Deferred (owner ledger, numbers unchanged or re-quantified)

- Phone heading rhythm 25.9 vs desktop 9.6 (uniform; touch-density call).
- Section padding systems (nav 10 / chat 6 / desktop 16) - each column is
  now internally consistent; the cross-column question stays with the
  chrome-inset contract comment, updated to describe the real per-column
  contract.
- Settings panel indent 13px (General inside frame padding, Appearance at
  edge), settings dialog title edges, Save below the fold, workspace panel
  four left edges, three create-button forms, pill badges.

Research: docs/design/research/roundb-lane-a.md (phone re-review),
roundb-lane-b.md (desktop + responsive verification),
roundb-lane-c.md (token layer re-review).
