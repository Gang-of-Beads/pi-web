# Goal Round A triage: three glm lanes on layout coordination

Configuration: three lanes (phone walk / desktop+responsive sweep / token
layer) against the live 8505 stack with Playwright measurements. The
owner's four complaints, adjudicated with numbers; the mid-review parallel
fix commit (c9ab1c62) was re-measured by lane A with before/after values.

## Fixed in this wave

- **Button boundaries** (F3/E1): the hairline measured 1.35:1 vs surface -
  below perceptibility. Lifted to #3a424e (~1.8:1), border-muted to
  #262c35. The borderless touch-control family (row menu, Clean up, bulk
  select, chat dock controls, modal close, Files toolbar) gained :active
  surface-hover pressed states - the only pressed feedback a flat theme
  can give.
- **The fold button** (F1/A1): the hardcoded 999px circle joined the
  header's own radius token (2px); the header gained vertical insets so
  the 44px control no longer touches the screen top and the border line.
- **Heading distribution** (F2/B1): the auto margin + space-between double
  mechanism produced one 37.7px void and fixed 20px steps; distribution is
  space-between alone (measured 25.9/25.9/25.9 uniform), and the coarse
  gap stepped 20px to 12px toward the app's rhythm.
- **Column edges** (C1/C2): the nav column's three left edges (6/11/16)
  collapse onto --pi-reading-edge (header, chips, sections share one
  edge); the quick switcher's sheet title aligns with its list content
  (x about 19, was 9).
- **Empty states** (D1): the new-session empty state centers in the
  viewport (was top-anchored with 591px of nothing); the tasks/relays
  dashed boxes center in their panels.
- **Files toolbar** (lane A #5): Upload/Refresh take the 44px coarse
  floor plus pressed states.
- **Tile edge offset** (lane A #1): tiles' 2px inline padding removed -
  tiles and rows share the left edge.
- **Heading rhythm** (H1): one heading margin (space-2) across every list
  surface including the sheet's word-only headings.
- **Tasks title** (D5): panel title matches its tab.

## Clean bills (measured, recorded so nobody re-hunts)

Empty-state horizontal centering exact at all widths; session-row rhythm
uniform (58px, 12px gaps); tools grid uniform; chat-to-composer gutter
pixel-equal; settings dialog card centered; tile grids equal-height.

## Deferred (rhythm decisions for the owner, numbers recorded)

- Section padding 6/10/10 phone vs 16 desktop vs chat 6 - four values, no
  single owner.
- Row pad 8 vs tile pad 10; compact title 13px vs desktop 14px.
- Three "create" forms: solid +New session, ghost +Add project, the
  switcher's third form.
- Pill badges (unread, idle, environment override) vs the square scale.
- Settings dialog: Save below the 850px fold (scroll-in-form tradeoff);
  three button heights in one dialog (52/32/36).
- Files vs Tasks/Relays toolbar rhythm (padding 8 vs 10/12) - partially
  aligned this wave (floor + pressed), full unification is a refactor.

Research: docs/design/research/rounda-lane-a.md (phone walk),
rounda-lane-b.md (desktop + responsive), rounda-lane-c.md (token layer).
