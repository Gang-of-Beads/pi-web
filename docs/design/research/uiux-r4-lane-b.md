# UI/UX parity audit — Round 4, Lane B
## Pickers, dialogs and sheets after the scale work

Scope reviewed this round: `ModelPicker`, `CommandPicker` (also serves as the thinking-level
picker — there is no separate ThinkingPicker; `PiWebApp.ts:3653-3655` routes the thinking
trigger through `CommandPicker`), `QuickSwitcher` (incl. its row menu), `SettingsDialog` and
its panels (General, Appearance, Sessions, Plugins, Shortcuts, Machines, Packages, Fleet),
`SettingsPanelFrame`, `SessionCleanupDialog`, `SessionRenameDialog`, `AskUserCard`,
`ExtensionDialogCard`, `AuthDialog`, `ModalSurface`, plus the plugin-side
`ProjectDialog`/`addProjectDialog` and `MachineDialog`.

Everything below is a **new** finding (checked against rounds 1–3 reports and the triage
doc) unless it sits in the clearly-labeled carryover appendix. Known-open items skipped:
modal layer inversion, picker “current value” prose, drawer tab 22px min-height.

---

## New findings

### N1. QuickSwitcher paints **two unread marks in the same slot, in two different colors** (one of the house patterns, bypassed)
**Where:** `src/client/src/components/QuickSwitcher.ts:211-213` (template), `:428-434` (styles);
`src/client/src/components/sessionStateBadgeStyles.ts:26,37`; `src/client/src/components/activityBadge.ts` (`renderSessionStateBadge`).
**Confidence:** high (code-level proof); medium-high on frequency of the trigger state.

Line 211 renders `renderSessionStateBadge(stateKind, unread && stateKind === undefined ? "Unread activity" : undefined)`.
When `stateKind === undefined` and the session is unread, that renders
`.session-state.unread` — the house **purple** 8px dot with a 2px purple halo
(`sessionStateBadgeStyles.ts:37`, and its comment: “Unread is purple … distinct from the
blue of work in progress”). Line 213 *also* renders `.row-flag.unread`, which is
`background: var(--pi-accent)` (`QuickSwitcher.ts:431`) — the house **blue**, the color the
badge system reserves for work in progress (`state-dot` uses `--pi-accent`,
`sessionStateBadgeStyles.ts:39`). Both spans are `position: absolute; bottom: var(--pi-space-4);
right: var(--pi-space-6)` (`:428`) — the same absolute slot, so they overlap exactly: a blue
dot painted over a purple dot (purple halo bleeding around it), and **two `role="img"` nodes
with the same “Unread activity” label** read in sequence by screen readers.

Line 211 and line 213 guard on the *identical* condition (`unread && stateKind === undefined`,
modulo `&& !interrupted`) — the duplication is unconditional, not an edge branch.

**Reachability:** `sessionActivityCategory` returns `undefined` exactly when
`status === undefined && activity?.phase !== "active"` (`src/shared/sessionActivityState.ts:31`)
— i.e. finished/unloaded sessions. The unread set comes from the server-side unread catalog
(`src/client/src/sessionUnread.ts`, wired at `PiWebApp.ts:300,903,3825`), which is orthogonal
to live status. Unfinished sessions are *read* on selection; the unread backlog is
overwhelmingly *finished* sessions — so `stateKind === undefined && unread` is the normal
unread case, not a corner.

Interrupted + unread composes differently but also badly: line 195 forces `stateKind = undefined`
when interrupted, so line 211 paints the purple unread dot while line 212 paints the amber
interrupted ring in the same slot — a dot-inside-a-ring hybrid that matches nothing else
(the house composite for state+unread is the `.unread-ring` wrapper in `activityBadge.ts`).

**Why this is a pattern break, not taste:** `SessionList` had this exact bug and fixed it with
the `sessionRowIndicator` arbiter (`src/client/src/components/sessionRowIndicator.ts`; used at
`components/SessionList.ts:418`) whose documented priority table resolves exactly this
unread-vs-state composition to **one** mark. QuickSwitcher never adopted the arbiter and also
disagrees on the unread color itself (accent blue vs the house purple used by the badge styles
and SessionList).

**Minimal failure scenario:** open the switcher (⌘;) with one finished session that completed
while you were elsewhere. Its row shows a blue-cored, purple-haloed blob at the indicator slot
while the same session in the sidebar shows a single purple dot; a screen reader announces
“Unread activity” twice.

**Fix:** route QuickSwitcher rows through `sessionRowIndicator`/`renderSessionStateBadge`
alone and delete the `.row-flag.unread` sibling (and make `.row-flag.unread` use the same
purple as every other unread mark if it must survive).

---

### N2. Adjacent Settings panels ship three different checkbox sizes, one of them without `accent-color` (sibling-control divergence)
**Where:**
- `src/client/src/components/settings/SettingsSessiondPanel.ts:144` — `.toggle input { width: 16px; height: 16px; }` (**no `accent-color`**)
- `src/client/src/components/settings/SettingsPluginsPanel.ts:218` — `.toggle input { width: 18px; height: 18px; accent-color: var(--pi-accent); }`
- `src/client/src/components/settings/SettingsAppearancePanel.ts:124` — `.follow input { … width: 24px; height: 24px; … accent-color: var(--pi-accent); }`

All three are the same UI pattern — a `<label class="…"><input type="checkbox"> + text`
boolean row — rendered inside the *same* dialog, reachable by tapping adjacent nav entries.
The house selection-checkbox size is 24px (`SessionList.ts:727`, `ProjectDialog.ts:356`
coarse block). 16px is the UA default size, and without `accent-color` the Sessions panel’s
checked box uses the browser/OS default fill (blue on Chrome, purple-ish on iOS) instead of
`--pi-accent` — visible against any re-accented theme (the theme pack work `b8072ba6` made
accent per-theme).

**Minimal failure scenario:** Settings → tick a box in “Sessions”, open “Plugins”: the check
box changes size (16→18px) and its checked color changes (UA default → accent); open
“Appearance” (follow-replies): 24px. Three sizes and two checked-colors in one dialog.

**Why no guard saw it:** `dotScale.test.ts` only inspects lines that also carry
`border-radius: 50%`/pill or the dot class names; square checkboxes are invisible to it.
**Confidence:** high (code facts); medium on salience (the size step is small but continuous
and user-facing; the missing accent is theme-dependent).
**Fix:** one shared `.check-row input` rule (or `--pi-checkbox-size` token) at the house 24px
with `accent-color: var(--pi-accent)`, and extend the dot/scale guards to square controls.

---

### N3. `outline-offset` is the un-tokenized twin of the hardened focus ring — 42 literal declarations across 26 files, token unused on dialogs/pickers
**Where (in-lane subset):** `ModelPicker.ts:278 (-2px), :282 (1px)`; `CommandPicker.ts:104 (-2px), :108 (1px)`;
`QuickSwitcher.ts:403 (1px), :449 (1px)`; `AuthDialog.ts:270,271 (-2px)`;
`SessionRenameDialog.ts:34 (1px)`; `AskUserCard.ts:524 (-3px), :566 (2px)`;
`ExtensionDialogCard.ts:404 (-2px), :477 (2px)`; `SessionCleanupDialog` (uses `button:focus`,
no ring at all — noted under N3b); plus out-of-lane instances (`ActionPalette.ts:106`,
`AppContextBar.ts:73,82`, `AppContextSwitcher.ts:108`, `ContextSwitcherSheet.ts:86`,
`ChatView.ts:138,154,176,310,399`, `AppNavigationPanel.ts:464,472,481`, `AuthDialog`,
`MachineDialog.ts:139`, `ProjectDialog.ts:335`, `SettingsShortcutsPanel.ts:365`, files/goals
panels).
The token exists — `--pi-focus-ring-offset: 2px` (`src/client/index.html:100`) — but only
three declarations repo-wide consume it (`ChatView.ts:302,335,46`); 42 literal values remain
across 26 files. Round-3’s guard hardening
covered the `outline:` shorthand; **no test anywhere references `outline-offset`** (grep of all
`*.test.ts` is empty).

**Minimal failure scenario:** the focus ring of a focused picker row sits flush over its text
baseline (`-2px`, inset under the border) while the search input in the *same picker* floats a
1px ring outside; a theme that thickens `--pi-focus-ring-width` (the token round 1 added for
exactly this) makes the 1px-offset rings collide with the control border while the tokenized
rings stay correct. On filled controls specifically: focused `.row.selected` in QuickSwitcher
already paints `--pi-selection-bg`; a 1px-offset ring in the accent hue over an accent-tinted
row is near-invisible (≈ the row’s own tint), whereas the sibling pickers inset the ring into
the row where it reads. Confidence: high on the escape (guard-verified), medium on the
contrast consequence per theme.

**N3b (same finding, one instance):** `SessionCleanupDialog` styles have no `:focus-visible`
rule at all — its buttons/checkboxes fall back to the UA ring while every sibling dialog draws
the accent ring. Same cluster, same fix sweep.

---

### N4. `SessionCleanupDialog` hard-codes the mono font stack on the project column, bypassing `--pi-font-mono`
**Where:** `src/client/src/components/SessionCleanupDialog.ts:238` —
`font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;`
Every other mono use in the same dialog family goes through the token
(`--pi-control-font-family`/`--pi-font-mono`, e.g. `ProjectDialog.ts:338`,
`SessionCleanupDialog.ts:222` itself uses the token for its inputs). The type-scale guard
checks sizes and the `font:` shorthand; a bare `font-family:` literal is invisible to it.
**Failure scenario:** the theme pack (the layer that ships `--pi-font-mono` overrides, cf.
`index.html:104` “A theme or …”) swaps the mono face; every path rendered in the app re-skins
except the cleanup dialog’s path column — a visible one-off in the exact table where the user
is comparing paths before deleting.
**Confidence:** high (it is an escape mechanically); low-medium severity (default stacks match).

---

### N5. AskUserCard free-answer indent is a magic 32px tied to the UA checkbox size (minor)
**Where:** `src/client/src/components/AskUserCard.ts:570` —
`.other-answer { padding: … 32px }`. The `.option` rows (`:546-568`) lay out as
`grid-template-columns: auto 1fr; gap: var(--pi-space-4)` with an **un-sized native checkbox**
(`input { margin: …; accent-color: … }`, `:564` — UA size, ~16px desktop, varies by browser).
32px only equals checkbox(16) + gap(16) while the checkbox is exactly 16px. The spacing guard
skips values >24px as “structural”, so it passes while being non-structural — it is a derived
offset, not reserved control room.
**Failure scenario:** a browser that renders the native control larger (or a future pass that
puts the checkbox on the house 24px per N2) silently misaligns the free-answer block from the
option labels it is supposed to hang under. **Confidence:** medium (dependent on UA sizing).

---

### Checked and found clean this round (do not re-litigate)
- **Danger text on danger tint**: re-measured with shipped tokens (`--pi-danger: #ff7b72`,
  `index.html:144`): on `.notice.error` bg ≈6.5:1, `SessionCleanupDialog .dialog-error` ≈6.6:1,
  `MachineDialog .dialog-error` ≈5.9:1. The earlier “4.3:1” worry used a wrong danger value —
  passes AA everywhere it’s used.
- `SettingsDialog` mobile block: former 14px/18px literals are now tokenized/`max(…, env())` —
  round-3 B2 is fully closed.
- `ModelPicker`/`CommandPicker`/`SettingsDialog` type tokens, close-button comfort bumps,
  accent-fill primaries with `--pi-on-accent`: verified in place, not re-reported.
- `ProjectDialog`/`MachineDialog` fonts, focus rings, coarse floors, accent primaries: fixed
  state confirmed.

---

## Carryover appendix — cited in round 3, triage accepted only 4 of Lane B’s 11, still open in code
These are **not** counted as new findings; they are listed so the fix pass can converge them
without treating them as fresh reports. (Round-3 refs in parentheses; triage:
`docs/design/review-triage-uiux-rounds-2-3.md`.)

- **C1 (r3-B5)** `AskUserCard.ts:495` header `padding: … var(--pi-space-5)` horizontal vs
  `fieldset.question { padding: var(--pi-space-7) }` (`:520`) — the sticky header title sits
  6px left of the question column it labels. Still present at the same lines.
- **C2 (r3-B7)** `SessionCleanupDialog.ts:221` checkbox still `16px` (now with accent-color),
  and the coarse block (`:249-252`) bumps only `button`/`.close-button` — table checkboxes
  remain ~16px touch targets next to 44px rows.
- **C3 (r3-B8)** `SessionCleanupDialog.ts:231` `.selection-controls button` still sizes by
  padding+12px text with no `--pi-control-height-*` floor on fine pointers.
- **C4 (r3-B9)** `SessionRenameDialog.ts:33` input still `font: inherit` → 14px text in a text
  input; iOS focus-zoom threshold (16px) unmet — every sibling input uses
  `var(--pi-control-font-size, 16px)`.
- **C5 (r3-B11b)** `QuickSwitcher.ts:430,434` `.row-flag` is content-box with `border: 2px` on
  `.interrupted` — renders a 12px ring against 8px dots (`--pi-dot-md`, `index.html:94`). Fix
  commit `64045ac4` edited this exact rule cluster (tokenized `right:`) but left the border
  expansion; `dotScale.test.ts` cannot see border growth. Fold into N1’s arbiter fix: one mark,
  `box-sizing: border-box`.
- **C6 (r3-B10, low)** `ExtensionDialogCard.ts:426` `.dialog-input { width: calc(100% - 32px) }`
  — magic 32px escape hatch for the absolute clear button instead of a positioned grid.

---

## Suggested fix order
1. N1 + C5 together (QuickSwitcher row marks → single arbiter; one unread color).
2. N2 + C2 (one checkbox rule/token for all boolean rows; extend guards to square controls).
3. N3 + N3b (+ C4, whose input also needs the focus-ring/size pass) as one mechanical sweep:
   `outline-offset: var(--pi-focus-ring-offset)` where semantics match, plus a guard test
   mirroring the `outline:` guard, with an explicit allowlist for the intentional inset cases
   (`-2px/-3px` on bordered rows) so the escape becomes a decision, not an accident.
4. N4, N5, C1, C3, C6 — one-line each.
