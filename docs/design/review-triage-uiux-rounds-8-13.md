# Review triage — UI polish convergence, rounds 8 to 13

Rounds 1–7 are in `review-triage-uiux-round1.md`,
`review-triage-uiux-rounds-2-3.md`, `review-triage-uiux-rounds-4-5.md` and
`review-triage-uiux-rounds-6-7.md`. The convergence criterion is the owner's:
run rounds until one whole round returns zero findings across all three lanes.
No self-imposed round cap (the round-five audit rejected one).

## Counts and commits

| round | A | B | C | total | commits |
|---|---|---|---|---|---|
| 8 | 8 | 3 | 10 | 21 | `b9e0a828`, `273f82ba`, `925ae00f` |
| 9 | 7 | 10 | 14 | 31 | `0acbe369`, `3e45b97c`, `d167533d` |
| 10 | 8 | 6 | 12 | 26 | `2e5beb47`, `24fe4032`, `843e103e` |
| 11 | 5 | 9 | 12 | 26 | `964ada31`, `b3ae9c83` |
| 12 | 7 | 8 | 10 | 25 | `2fc98ecd` |
| 13 | 6 | 8 | not delivered | 14 so far | `62c33455` |

Round 13 lane C is **not a zero-finding lane**: it failed twice on anthropic
429 and once when the extension session reloaded, and was relaunched on the glm
lane. A lane that did not run is recorded as not run.

## What these rounds actually produced: four new guards

Hand-sweeping was already known to be the wrong tool at this scale. Rounds 8–13
turned each repeated defect *shape* into a test:

| guard | the shape it names | what it caught |
|---|---|---|
| `boxModelGuard` (r8, extended r9 and r11) | a stated size plus a visible border, or a control floor plus padding, with no `box-sizing` — first same-rule, then cross-rule for one selector | a state ring drawn 12px from an 8px token; seven close controls drawn 34 from 32; the boot primary button drawing 62 for a declared 44; the add-project footer drawing 50 for 32 |
| `spacingScale` extension (r8) | spacing spelled as a position (`top`, `right`, `bottom`, `left`, `inset`) | 33 literals became steps; deliberate between-step trims are named in the guard instead of typed into rules |
| `pointerQueryOrder` (r9) | a `(pointer: coarse)` floor written before a base rule with the same selector — a media query carries no extra specificity | row menu items measured 36px on a phone against a declared 44; the same for the rename input and its actions |
| `tokenReferences` (r5, still earning its keep) | `var(--pi-*)` with no fallback and no definition | `--pi-bg-raised` still named by the context sheet after deletion |

The lesson these encode: **the token in a declaration being correct is not
evidence that the rendered value is correct.** Every guard above passed on the
defect it was later written to catch.

## Root-cause families seen repeatedly

1. **Arithmetic that went stale.** A derivation kept its form after its inputs
   changed (tile dot subtracting a 10px dot's radius after the scale settled on
   8; a checkbox row's top margin tuned for a 14px box after it grew to 24).
2. **Box model.** Content-box plus padding or border makes the token a floor
   under something else, not the height.
3. **Styling a state the renderer never emits.** `.activity-dock.active` when
   `activityCategory()` returns `working`: the one state the dock exists for
   fell through to the neutral look. No guard can see this; the renderer and the
   stylesheet were each internally valid.
4. **A rule inherited by a surface it was not written for.** The phone rule that
   hides a word-only heading is right in the panel (a row above names the step)
   and wrong in the sheet (three lists stacked with nothing above them). Fix:
   the rule asks its surface, through an inheritable custom property.
5. **Marks typed instead of drawn.** ▸ ▾ ⧉ ↻ ↩ ✓ ✖ ▶ ↑ ↓ ☑ ⓘ ‹ › ＋ ⚑ each took
   whatever font resolved it, at whatever ink that font gave. Fixed by one
   `disclosureIcon` and one `uiIcons` module, plus a plugin-host seam so
   contributed lists borrow the shell's chevron rather than copying a glyph.
6. **Sweeps that stopped at the files that were read.** The same fix landed
   round after round in siblings that had been missed (close controls, checkbox
   centring, `--pi-dim` on informational text, disclosure glyphs).

## Contrast rulings (measured, not argued)

- `--pi-muted` on the page surface **5.56:1**, on the card **4.71:1** — the
  lane's 4.42 claim was judged **not true** (round 5, probe recorded).
- `--pi-muted` on the **selection tint** genuinely measures **4.42:1** (round
  10). A palette is the owner's to change, so the fix was app-side: secondary
  copy steps up on a selected row — measured **7.27:1**.
- Status hues on the raised card at 11px: success **3.97**, warning **3.80**,
  accent **3.50**, danger 4.63 (round 12,
  `scripts/probe-status-hue-contrast.mjs`). Fix again app-side: the hue rides a
  mark, the word takes body colour.
- The activity dock's state dot carried a 0.45 opacity layer that only two of
  five states lifted: idle **2.18:1**, asking **2.42:1**, error **2.37:1**,
  under the 3:1 floor for a graphic (round 13). Opacity layers stay banned for
  meaning-carrying marks.

## Regressions this process caught in its own work

Worth recording, because they argue for keeping the lanes reading the working
tree and not only HEAD:

- round 11 drew the bulk-selection tick but never sized it, so the icon filled
  its whole control (32/44px beside 16px chrome) — caught in round 12.
- round 12's 16px rename field was eaten by a `font: inherit` later in the same
  rule — caught by lane C reading uncommitted changes in the same round.
- round 10's context-sheet fix removed a wrapper and the group headings
  disappeared behind an inherited phone rule — caught in the same round.
- round 8's conversation-meter halo was erased by a second `box-shadow` in the
  rule that introduced it — caught in round 9.

## Still open (owner's call, not defects to fix silently)

- The model picker announces the current model as prose inside the row label
  (`✓ current`); the auth dialog welds provider state to the row title as green
  prose. Both are product semantics.
- Drawer tab height 22px is pinned by `composerRoom.test.ts:134`.
- Modal layer inversion is resolved by the picker declaring `abovedialog`, not
  by changing the registry's paint order (`ModalSurface.test.ts:461`).
