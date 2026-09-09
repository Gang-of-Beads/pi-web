# Phone quality: naming roles instead of arithmetic

Status: proposal. The numbers below were measured on the 8505 stack at 393x850
with a coarse pointer (`scripts/probe-phone-density.mjs`), not recalled.

## What is actually on screen today

| Thing | Measured |
| --- | --- |
| Context bar / compact header | 45px each, stacked with the search field |
| List search field | 44px, 16px text |
| Chrome above the first row | ~89px, 10.5% of an 850px viewport |
| Grid tile | 177x85px, 14px title, 11px subtext |
| Settings row | 59px, 17px/600 title, 13px subtext |
| Distinct edge insets on one screen | 6, 10, 12, 15, 16, 25 |
| Distinct type sizes on one screen | 11, 12, 13, 14, 16, 17 |

The defect is not any single number. Six edges and six type sizes coexist
because our tokens name *arithmetic* - `--pi-space-2`, `--pi-text-sm` - and
nothing names the *role*: what a reading edge is, what a row title is, what a
row's second line is, how much vertical budget chrome may take before content.
Two correct-looking choices in two files produce two different edges, and no
guard can object, because neither is wrong on its own terms.

## The proposal, independent of which density is chosen

Add role tokens, derived from the existing scales, and make the guards check
that surfaces use the role rather than the arithmetic:

- `--pi-reading-edge` - the distance from the screen edge to text a person
  reads. One value per breakpoint, used by every list, sheet and panel.
- `--pi-row-title` / `--pi-row-subtext` - the two lines a list row may have.
- `--pi-chrome-budget` - the maximum height chrome may occupy above content,
  enforced by a probe rather than by hope.
- `--pi-tile-title` / `--pi-tile-subtext` - the grid equivalents.

This is mechanical, testable, and does not change what the app looks like
until a density is chosen. The choice below is what changes the look.

## Density options (pick one)

### A. Keep the current density, unify the values

Nothing gets bigger or smaller; the six edges collapse to one reading edge
(16px) and the six type sizes to four roles (17 title / 13 subtext / 16 input /
12 eyebrow). Chrome stays ~89px.

- Cost: smallest change, one visual pass.
- Risk: the phone still spends 10.5% of the viewport on chrome before content.

### B. Reclaim vertical space

A, plus: merge the context bar and the compact header into one 48px row, and
let the search field appear on demand rather than permanently. Chrome above
content goes from ~89px to ~48px, giving roughly 41px - about one more list
row - back to content.

- Cost: search becomes a control rather than a field; one more state to design.
- Risk: a search that must be summoned is a search some people never find.

### C. Content-first, chrome on demand

B, plus: the header collapses on scroll and returns on scroll-up, and tiles
lose their subtext line at this width (85px to about 64px), fitting more per
screen.

- Cost: the largest change; scroll-linked chrome needs its own probe to prove
  it cannot strand a control off-screen.
- Risk: hiding the subtext removes the only place a tile says which machine or
  path it belongs to.

## What is not being proposed

Changing the palette, the radius language, or the touch floors. Those are
settled and guarded; this is about how much of the screen the product spends on
itself, and about naming the roles so the answer stops drifting.


## What landed (updated 2026-09-09)

The owner's direction: adaptive, minimal, textured; not more than one bar top
and bottom, with a fold/unfold control. Measured on the 8505 stack at 393x850,
before and after:

| Measure | Before | After |
| --- | --- | --- |
| Nav view chrome above first row | 90px (10.6% of 850) | **45px (5.3%)** folded; +53px transient row only while unfolded |
| Chat view chrome | 45px | 45px (single bar, unchanged) |
| Search field | conditional, 44px | conditional, 44px (unchanged) |
| List text-start distances | 10 / 15 / 16 across lists | one token: `--pi-reading-edge` = 10px on phone (16px desktop) |
| Distinct type sizes on one screen | 6 (11–17) | 5 (11–16); settings rows keep 17/13 |

Also fixed on the way: the collapsed composer read as a broken rounded input
box (the owner reported it); it is visibly a control now - solid surface,
squared corner, chevron - with the collapse behaviour itself unchanged.

Still open, the owner's call: whether the two row idioms (management lists
14/11, settings rows 17/13) merge into one pair of type roles or stay as
context-scoped tokens. Either way the tokens would be locked against drift;
the merge changes one of the two appearances.
