# Goal Round F triage: the palette brace regression caught at the reader

Configuration: three glm lanes verified the Round E fix wave (b2f826b5) at
reader level with delivery checks.

## Verification verdict

**Both Round E fixes reached readers**: the goals refresh hover regression
is repaired (hover bg rgb(27,32,39) live-measured on desktop), and the
bare-small family renders at the 11px scale floor at all four producers
plus a session-row meta side-observation.

## New TRUE: the palette brace regression (F-1, fixed this wave)

The bare-small insert consumed the `.options button` rule's closing brace -
the same bug class as the goals hoist two commits earlier. Every following
rule collapsed into dead nesting (CSSOM-proven): the selected highlight,
hover, disabled dimming, coarse single-column override and the palette
empty-state padding all measured dead at the reader; keyboard users could
not see the selected item. Fixed: the brace restored, and the
action-menu-panel items joined the coarse pressed-state family (the one
producer the sweeps kept missing because the panel renders on demand).

## Deferred ledger (re-quantified, unchanged)

All Round A-F deferred items re-measured and unchanged. New ledger entry:
terminal panel line-height 16px px-literal joins the leading-ramp item
(E-2 family).

Research: docs/design/research/roundf-lane-a.md, roundf-lane-b.md,
roundf-lane-c.md.
