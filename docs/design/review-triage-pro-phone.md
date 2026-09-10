# Pro phone walk: two glm lanes with Playwright (393×850 coarse + 1280 desktop)

Configuration: two lanes clicking every surface with real touch taps,
screenshotting each state, plus a consistency audit with measured numbers.
Triggered by the owner's three reports: pages piling up on the phone,
same-category elements changing size between surfaces, spacing feeling
uneven.

## The "pages pile up" verdict (both lanes agree)

**No hard render-stack bug exists**: phone navigation is full-page
replacement (one main surface in the DOM at a time, census-verified). The
pile-up perception has three real mechanisms:

1. **Overlays with no separation** (the big one): the pro redesign set the
   shadow colours transparent and the overlay stayed at #0008 - a 50% black
   over the #0d1117 base is nearly invisible, so palettes, dialogs and row
   menus read as text printed over text. Fixed: overlay deepened to #000c.
   Row menus covering cards is normal popover behaviour once separation
   exists.
2. **The sessions heading overflow**: the heading packs
   [word][checkbox][unread][count][Clean up][+New session] on one nowrap
   row; when the unread badge appears, the only shrinkable item is the
   title word, and the checkbox slides onto it (the owner's "Ses☑on"
   screenshot). Fixed: the heading wraps on coarse pointers instead of
   crushing.
3. **Quick switcher machine tab** leaves the sheet and the sessions list
   on screen together with contradictory copy ("Open a session on this
   machine first" beside "Loading sessions…") - layout-legal but incoherent;
   deferred to the quick-switcher redesign with the note.

## Same-category size unification (the "变大/变小" verdict)

- **Context chips**: the value text stepped down by container width -
  ~103px in the projects nav, ~150px in the sessions drawer - so the same
  control changed size between surfaces. Fixed: one size per pointer
  (coarse = the compact 2xs everywhere).
- **Settings controls**: on desktop the Port input was 32px and the
  neighbouring Allowed hosts select 43px (min-height only; the select's UA
  padding out-grew it). Fixed: the form controls are height-pinned.
- **Quick switcher search**: 17px vs the lists' 16px. Fixed to the control
  size.
- **panel-toggle** rendered at the UA's 13.3333px (no font on the button
  rule). Fixed with font: inherit.
- **Search heights projects vs sessions**: measured equal (44px coarse,
  36px desktop) - the owner lead was not reproduced; the real split was
  the switcher's 17px.

## Alignment/cohesion fixes in this wave

- The compact header's pill buttons and the panel edge handle join the
  pro radius scale (they were last-generation pill leftovers).
- The conversation meter slid 8px over the first message card's sticky
  header (z 6 over z 4, both platforms); it now slides under.
- The scope chip's "pi-web · pi-web" dedupes a workspace named after its
  project.
- Escape now closes the project row menu (every other surface's Escape
  closed its top layer; this one ignored it).
- The Tasks tool panel title matches its tab ("Tasks", not "Workspace
  Tasks").
- The Pro theme card description fits its 2-line clamp; the dead
  concentric-radius comment restated for the pro scale; the font-stack
  comment describes the mono design.

## Deferred with written reason

- Sheet "+ Add project" opens the dialog UNDER the still-open sheet
  (reproduced by probe: projectDialog true, modals 2, sheet not closed) -
  fix needs the modal-layer ordering decision, not a band-aid.
- Quick switcher machine-tab co-screen (P3) - quick-switcher redesign.
- More-actions collapse row stays open after a dialog closes (design
  ambiguity: the row is an independent toggle).
- Pill badges (unread counts, "idle", environment override) vs the square
  scale - owner adjudication (B4); the button/handle pills were the clear
  breaks and are fixed.
- Spacing rhythm numbers for the owner: list sections 6/10/10 phone vs
  16 desktop vs chat 6 (four values, no single owner); row pad 8 vs tile
  pad 10; compact title 13 vs desktop session-title 14; "+ New session"
  solid vs "+ Add project" ghost vs the switcher's third form. These are
  rhythm decisions, not bugs.

Research: docs/design/research/prophone-lane-a.md (click-walk),
prophone-lane-b.md (consistency audit with measurements).
