# ROUND NINE — LANE B: pickers, dialogs and sheets (visual-polish convergence audit)

Scope: `ModelPicker`, `CommandPicker`, `AuthDialog`, `QuickSwitcher`, `ModalSurface`,
`SessionRenameDialog`, `SessionCleanupDialog`, `SettingsDialog` + panels,
`AskUserCard`, `ExtensionDialogCard`, `ContextSwitcherSheet`.
HEAD `925ae00f` (round eight, lane C). Findings below are NEW against rounds 1–8; every
one of them is invisible to the existing guards (`controlHeightScale`, `spacingScale`,
`dotScale`, `typeScale`, `radiusScale`, `boxModelGuard`, `tokenReferences`) for the reason
given in each item.

Ordering: strongest first.

## F1 The model picker still marks the active model with a bare " ✓ current" in the row label
- `src/client/src/components/ModelPicker.ts:175` — `<span>${entry.id}${value === this.selectedValue ? " ✓ current" : ""}</span>`
- Surface: model picker, catalogue (grouped) mode — the widest, most-used list in the app.
- Finding: the active model is announced by a glyph plus two words concatenated into the
  row's identifier text, at the row's own 14px, in `--pi-text` — the same colour and size
  as the model id it is commenting on. State is carried by prose inside a data string.
  Its sibling surfaces in this exact family were converted in the last two rounds:
  `QuickSwitcher` "· main" became a real mark (commit `509bfcf0`), and the theme card's
  "· in use" became `.theme.active .theme-name::after { content: ""; width: var(--pi-dot-sm) … }`
  (`SettingsAppearancePanel.ts:137`). The model picker was left behind.
  Two consequences that are geometric, not stylistic: (a) the suffix changes the inline
  length of the label, so rows whose id is otherwise the same length stop ending at the
  same column and the eye can no longer scan the id column; (b) `✓` (U+2713) has an ink
  box centred well above the x-height centre of the 14px id beside it, so the check rides
  visibly high relative to the word it belongs to — the row reads as one long string.
- Minimal failure scenario: open `/model`, scroll a provider with many entries. Two
  consecutive rows read `claude-sonnet-4-5 ✓ current` and `claude-sonnet-4-5:1m` — the
  reader has to parse the sentence to know which model is live, and the "current" text is
  indistinguishable from part of the model name.
- Confidence: high. (Fix already exists in two sibling files, so this is drift, not taste.)

## F2 In three of the four pickers, the mouse hover fill is the same token as the keyboard cursor fill
- `src/client/src/components/ModelPicker.ts:301-302` (`.options > button.selected` / `:hover` → both `--pi-selection-bg`), `:304-305` (catalogue rows, same), `src/client/src/components/CommandPicker.ts:117-118`, `src/client/src/components/AuthDialog.ts:278-279`.
- Contrast with the one surface that got it right: `QuickSwitcher.ts:412` hover →
  `--pi-surface-hover`, `:424` cursor row → `--pi-selection-bg` **plus**
  `border-color: var(--pi-accent)` — two channels, so the two states never collide.
- Surface: every list where Enter and click can disagree — model picker, command picker,
  provider list in the auth dialog.
- Finding: `selected` here is not "the chosen value", it is the keyboard cursor
  (`selectedIndex`, moved by Arrow keys and by `@focus`). Hover paints exactly that
  background, in a strong tint (`--pi-selection-bg: #0d2847` against `--pi-bg: #0d1117`),
  and adds nothing else. So the list can show two identical "current" rows at once, and
  the one that is actually current is the one the mouse did not touch.
  Guard-blind: both values are published tokens, and the second rule is inside
  `@media (hover: hover)`.
- Minimal failure scenario: `/` → type `mar` → the cursor sits on "markdown-table" →
  slide the mouse over "margin-notes" to read it → two rows are now the same colour and
  Enter runs the one under neither. Same in the model picker: hover to inspect a second
  model, then press Enter and the wrong model is applied.
- Confidence: high on the code facts, high on the consequence (the fill is the only cursor
  signal in these three files; `aria-current` is not a visual state).

## F3 The auth dialog's field rule is written for the list step and lands inside a padded step: the input sits 12px right of its own label
- `src/client/src/components/AuthDialog.ts:275` — `input { margin: var(--pi-space-5) var(--pi-space-6); … }`
- `src/client/src/components/AuthDialog.ts:283` — `.form { display: grid; gap: var(--pi-space-6); padding: var(--pi-space-7); … }`
- Surface: auth dialog, the OAuth / device-code step (`.form`), and the same `input` rule
  that positions "Search providers" on the list step.
- Finding: on the provider-list step the modal body has no padding, so `margin-inline:
  var(--pi-space-6)` (12px) is what puts the search field on the same 12px reading edge as
  `header { padding: var(--pi-space-6) }` (line 265) and `.options button { padding: …
  var(--pi-space-6) }` (line 277). That is correct, and byte-identical to
  `ModelPicker.ts:287`. The same `<input>` element type is also used inside `.form`, which
  already carries `padding: var(--pi-space-7)` (16px) **and** `gap: var(--pi-space-6)`
  (12px). Result, all measured from the dialog edge: the prompt `<label>` and the `.actions`
  row start at 16px, the field underneath the label starts at 28px — the field is inset
  12px from the thing it belongs to; and the field's vertical spacing is `12 + 10 = 22px`
  above and below while every other pair in that grid is 12px apart. Inside one dialog the
  reading edge is also inconsistent (12px in the header, 16px in this body).
  Guard-blind: every value is a token; `spacingScale` cannot see that a margin written for
  one container is being consumed inside another, and grid `gap` + item `margin` are summed
  by the layout, not by the guard.
- Minimal failure scenario: Settings → Providers → pick Anthropic → "Open the login URL":
  the label "Paste the code" and the box under it are not left-aligned, and the box floats
  22px away from both neighbours. Then tab back to the provider list and the edge jumps
  back to 12px.
- Confidence: high.

## F4 Two settings panels bypass the frame heading, so their title sits in a 16px dead band and is drawn with a different type treatment
- `src/client/src/components/settings/SettingsAppearancePanel.ts:33` and
  `src/client/src/components/settings/SettingsMachinesPanel.ts:37` — `<settings-panel-frame>` with **no** `heading=` attribute; both panels then render their own `<div class="heading"><h2>…</h2>` as frame *content* (`SettingsAppearancePanel.ts:34-39`, styles `:122`).
- `src/client/src/components/settings/SettingsPanelFrame.ts:49-51` — the `<header class="section-heading">` is rendered unconditionally; with `heading === ""` it emits an empty `.heading-copy` and an empty `.heading-actions`; `:98` `.section-heading { … margin-bottom: var(--pi-space-7) }` (16px).
- Surface: the settings dialog, Appearance and Machines panels, against General / Packages / Plugins / Session daemon / Shortcuts which all pass `heading=`.
- Finding, three measurable consequences of one omission:
  1. **Dead band.** The empty header has height 0 but its `margin-bottom: 16px` is real, so
     these two panels start their content 16px lower than the other five. The title "Appearance"
     is not at the y where every other panel's title is, which is visible as soon as you tab
     through the section list.
  2. **Two title treatments for one role.** The frame's `h2` (`SettingsPanelFrame.ts:101`) is
     `font-size: var(--pi-text-lg); line-height: 1.25` with **no** `font-weight` → UA bold 700,
     `--pi-font-ui`. The panels' own `h2` (`SettingsAppearancePanel.ts:122`,
     `SettingsMachinesPanel.ts:107`) is `--pi-font-display`, `font-weight: var(--pi-weight-semibold)`
     (600), `letter-spacing: -0.01em`, no line-height. Same 20px step, two different faces,
     weights, tracks and leading — the strongest anchor on the page differs panel to panel.
  3. **Name.** `SettingsPanelFrame.ts:48` — `aria-label=${this.heading || "Settings panel"}`,
     so the section these two panels occupy is announced "Settings panel" instead of
     "Appearance" / "Machines"; their own `<h2>` never names the section it is inside.
  Guard-blind: no px literals anywhere in the chain, and the `margin-bottom` is a token.
- Minimal failure scenario: open Settings, press Down through the section list. The title
  snaps up 16px when you reach Appearance, changes weight and typeface, and the section's
  accessible name is the generic fallback.
- Confidence: high.

## F5 The auth dialog carries provider state as green prose welded onto the row title
- `src/client/src/components/AuthDialog.ts:69` — `title: html\`${provider.name}${provider.status.source !== undefined ? html\` <em>${statusLabel(provider)}</em>\` : null}\``
- `src/client/src/components/AuthDialog.ts:369-380` — `statusLabel()` returns `"✓ configured"`, `"✓ env: ANTHROPIC_API_KEY"`, `"✓ runtime"`, `"✓ custom key"`, `"✓ models.json command"`.
- `src/client/src/components/AuthDialog.ts:299` — `em { color: var(--pi-success); font-style: normal; font-size: var(--pi-text-xs) }`.
- Surface: provider list in the auth dialog — the list whose whole purpose is "which of
  these already works".
- Finding: same defect class as F1, and it is the one the previous rounds retired twice
  (QuickSwitcher's "· main", the theme card's "· in use"). It is inline text, so the mark's
  width is added to the name's width: a configured provider's title grows by up to
  ~140px ("✓ models.json command"), which makes the first line of two rows differ wildly in
  length while the second line (`${provider.id} · ${authTypeLabel(...)}`, line 70) stays
  monospaced-ish — the list loses its second scan column. The glyph is 12px `✓` inside a
  14px line box, sharing the baseline: its ink centre sits above the name's optical centre,
  so it reads attached to neither word. Because it is `<em>` inside the title, it also
  travels into `searchText`-adjacent contexts as part of the title, and any future
  truncation clamps the state before it clamps the name.
- Minimal failure scenario: two providers, one configured by env and one not. The
  unconfigured row's title is short; the configured one ends in a green sentence. Neither
  is a mark, and a colour-blind reader in a light theme sees only "slightly different grey
  text after the name".
- Confidence: high on class, medium on the truncation argument.

## F6 AskUserCard applies the 44px touch floor on desktop; the sibling dialog card in the same transcript does not
- `src/client/src/components/AskUserCard.ts:546-560` — `.option { … padding: var(--pi-space-4); … min-height: var(--pi-control-height-touch); box-sizing: border-box; }` (unconditional), with the comment "The coarse-pointer floor this project already holds everywhere else".
- `src/client/src/components/ExtensionDialogCard.ts:520-522` and `:533-534` — the same affordance gets `min-height: var(--pi-control-height-touch)` only inside the phone-width and `@media (pointer: coarse)` blocks; with the base `button { padding: var(--pi-space-4) var(--pi-space-6) }` (`:465-471`) and `.option-button { line-height: 1.35 }` (`:411-417`) a desktop option row computes to 8+8+18.9 ≈ **34.9px**.
- Surface: two cards in the same transcript stream, both "choose one of N", able to be on
  screen within a few rows of each other.
- Finding: the desktop row heights differ by 9px (44.0 vs 34.9) for the same affordance,
  and the *policy* differs: the project's floor is coarse-pointer-scoped everywhere else
  (AskUserCard's own `.primary-action/.secondary-action` floor at `:670` **is** scoped).
  A comment that says "everywhere else" is describing the media query it omits.
  Guard-blind: `controlHeightScale` only flags px *literals* in 28–44px; a token and a
  computed 34.9px both pass. No guard compares two files.
- Minimal failure scenario: ask a question with `AskUserDialog` (rows 44px, 8px gaps) and
  in the next turn let an extension open a select dialog (rows 35px, 16px gaps). Two
  option lists, one after the other, visibly different density, one of them "wrong".
- Confidence: medium-high (the numbers are certain; which one is the mistake is a call).

## F7 QuickSwitcher's row moves its own content when it enters rename mode
- `src/client/src/components/QuickSwitcher.ts:411` — `.row { … padding: var(--pi-space-5) calc(var(--qs-menu-size) + var(--pi-space-2)) var(--pi-space-5) var(--pi-space-6); }` → left inset **12px**, top **10px**.
- `src/client/src/components/QuickSwitcher.ts:501` — `.rename-row { grid-template-columns: …; align-items: center; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-5); }` → left inset **10px**, top **8px**. `:240` `<form class="row rename-row">` — the same element, both classes.
- Surface: session switcher, rename (the only state a row can enter in place).
- Finding: entering edit mode shifts the row's whole content column 2px to the left and 2px
  up. In a list whose entire job is vertical scanning, the text under the caret jumps
  sideways at the moment the user starts typing; and the edit field's left edge no longer
  matches the row above or below. The `.rename-row` override was clearly written for the
  two-column form layout, and the padding re-declaration was part of it.
- Minimal failure scenario: long-press a session → Rename. The title moves; press Escape
  and it moves back. Repeat, and it reads as a rendering glitch.
- Confidence: high (arithmetic), medium (severity).

## F8 AskUserCard's divider is not centred in the gap it stands in
- `src/client/src/components/AskUserCard.ts:545` — `.options { display: grid; gap: var(--pi-space-4) }` (8px)
- `:546-561` — `.option { … border: 1px solid transparent; padding: var(--pi-space-4) var(--pi-space-4); min-height: touch }`
- `:562` — `.other-option { border-top: 1px solid var(--pi-border-muted); padding-top: var(--pi-space-6) }` (12px)
- Surface: the Custom-answer row inside an ask-user card.
- Finding: from the previous option's copy to the rule there is 8px option padding + 8px
  grid gap = **16px**; from the rule to the Custom row's copy there is **12px**. A hairline
  that separates two options sits 4px closer to the lower one, so the group reads as
  "last option, then a tight pair" rather than one list. `box-sizing: border-box` plus the
  44px floor also means the rule eats 1px of the Custom row's content box, so its checkbox
  centre is 0.5px off every other row's checkbox centre in the same list.
- Minimal failure scenario: any ask-one question with a Custom option — the divider is
  visibly nearer the word "Custom" than the option above it.
- Confidence: high on geometry, low-medium on visibility.

## F9 The Custom answer's indent misses the option copy by 1px, because the transparent border is not in the arithmetic
- `src/client/src/components/AskUserCard.ts:572` — `.other-answer { … padding: var(--pi-space-2) var(--pi-space-4) var(--pi-space-2) calc(var(--pi-space-4) + var(--pi-checkbox-size) + var(--pi-space-4)) }` = 8 + 24 + 8 = **40px**.
- `:546-560` — `.option { border: 1px solid transparent; padding: var(--pi-space-4); grid-template-columns: auto minmax(0,1fr); gap: var(--pi-space-4) }` → the option's copy actually starts at 1 (border) + 8 (padding) + 24 (checkbox) + 8 (gap) = **41px**.
- Surface: ask-user card, the textarea / follow-up copy under the options.
- Finding: the `calc()` is an explicit, hand-written duplicate of another rule's box model
  and misses one term, so the block that exists to be indented under the options lands 1px
  left of them. Same class as F8's missing border.
- Minimal failure scenario: ask a question, tap Custom, watch the label and the textarea's
  left edge against the option labels above — they do not line up.
- Confidence: high on arithmetic, low on visibility (1px). Worth fixing by making the
  indent a shared value rather than a re-derivation.

## F10 Two state lines are sized by the UA's `font-size: smaller`, which is off the published type scale and invisible to the type guard
- `src/client/src/components/SettingsDialog.ts:775` — `.settings-nav small { color: var(--pi-muted); }` — no `font-size`; the markup is the section detail under the label (`:194` `<small>${detail}</small>`).
- `src/client/src/components/AuthDialog.ts:280` — `small { display: block; margin-top: var(--pi-space-2); color: var(--pi-muted); }` — the provider id / auth-type line in every option row.
- Scale reference: `--pi-text-2xs: 11px`, `--pi-text-xs: 12px`. At a 14px parent, UA
  `smaller` computes to **11.2px** — a step that exists in no token, and a line box of
  ~13.6px instead of 13.2 (2xs) or 14.4 (xs).
- Why the guard misses it: `typeScale.test.ts` matches `font-size:\s*\d+px` / `font:\s*\d+px`
  declarations. A rule that *omits* `font-size` on an element the UA sizes at `smaller`
  produces no match, so it can never be an offence.
- Proof it is drift and not a decision: `SettingsDialog.ts:787` declares
  `.settings-list-label small { font-size: var(--pi-text-sm) }` — the same `<small>` in the
  phone layout of the same dialog is tokenised; the desktop nav is not. So one string is
  drawn at a token step in one breakpoint and at a UA step in the other, and a theme that
  moves the type scale moves one and not the other.
- Minimal failure scenario: switch to a light/large type scale, or add a theme with a
  different `--pi-text-2xs`: the settings nav details and the auth rows' second line stay
  at 11.2px while every sibling caption moves.
- Confidence: high.

## F11 Two textarea floors, neither derived from the control-height family, 26px apart
- `src/client/src/components/settings/SettingsGeneralPanel.ts:279` — `textarea { resize: vertical; min-height: 94px; … }`
- `src/client/src/components/AskUserCard.ts:578-581` — `textarea { … min-height: 68px; max-height: 40vh; }`
- Surface: the custom-key / config textarea in Settings → General, and the Custom answer in an ask-user card.
- Finding: the control-height family is `32 / 36 / 44`; a multi-line field should be a
  multiple of one of its steps or of a line box. 94 and 68 are neither (94 is not a multiple
  of 4; 68 = 4×17). They are one-off numbers chosen by eye, in two files, for one control
  type — so the same textarea is a different height in the two places it appears, and
  neither follows the theme's control rhythm.
- Why the guard misses it: `controlHeightScale` only inspects `(min-)?(height|width)`
  literals in 28–44px. 94px and 68px are outside the window, and the guard's own note says
  the window is controls, not fields.
- Minimal failure scenario: compare Settings → General → "API key" field with an ask-user
  Custom field: same control, one is 94px, one 68px, neither on the ladder.
- Confidence: medium-high (real scale escape; the "right" number is a design call).

## F12 The context sheet's sticky header paints a token no theme defines, so the guard is told to ignore it
- `src/client/src/components/appShell/ContextSwitcherSheet.ts:85` — `.sheet-header { position: sticky; top: 0; z-index: 1; background: var(--pi-bg-raised, var(--pi-surface)); … }`
- Surface: the phone's "Change context" sheet.
- Finding: `--pi-bg-raised` is referenced by exactly this one rule in the whole repository
  and defined nowhere — not in the token block, not in the theme contract, not by a
  `setProperty`. It is the leftover of the round-four cleanup that removed the same dead
  name from the rename dialog (`tokenReferences.test.ts:9-16` names `--pi-bg-raised` as one
  of the three original defects). Because the reference carries a fallback, the guard skips
  it by design (`match[2] === ","` at `tokenReferences.test.ts:63`) — the fallback hides the
  bug instead of fixing it. The fallback that always wins is `--pi-surface` (#161b22), while
  the sheet's canvas is the dialog's `--pi-bg` (#0d1117): the sticky title bar is a band of
  the wrong stop of the surface ladder, and the published name for that stop is
  `--pi-surface-raised`. Lists scroll under a bar that is a different colour from the sheet
  it belongs to, with no border to justify the change.
- Minimal failure scenario: two machines / projects / workspaces on a phone → tap the scope
  chip → the "Change context" bar is a lighter slab than the sheet, and rows vanish under
  its edge instead of under the sheet's own surface.
- Confidence: high on the dead reference, medium on "wrong stop" (the fix is
  `var(--pi-surface-raised, var(--pi-bg))` or `var(--pi-bg)` + border, a design call).

## F13 The close control of a dialog is 32px in three surfaces and 36px in two
- 32px (`--pi-control-height`): `src/client/src/components/AuthDialog.ts:273`, `src/client/src/components/ModelPicker.ts:286`, `src/client/src/components/CommandPicker.ts:112`.
- 36px (`--pi-control-height-comfort`): `src/client/src/components/SettingsDialog.ts:766` (`.close-button`), `src/client/src/components/appShell/ContextSwitcherSheet.ts:87` (`.sheet-close`).
- Surface: the dismiss affordance of every modal in the lane; all five are
  `display: grid; place-items: center; padding: 0; font-size: var(--pi-text-xl)`.
- Finding: five byte-for-byte-sibling rules, two different boxes. The 36px variants also sit
  in a header whose other content is a 24px-tall title line, so the header height is set by
  the close button — meaning the same `×` glyph is centred in a 32px box in one dialog and a
  36px box in the next, and the dialogs' header bars differ by 4px for that reason.
  Guard-blind: tokens, not literals; and no guard compares files.
- Minimal failure scenario: open Settings (36px ×), press Esc, open the model picker (32px ×).
  The dismiss control moves 2px inward on both axes and its hit target shrinks by 8px of
  width.
- Confidence: medium (the inconsistency is certain; which size is correct is the call — the
  36px pair is the only one that also appears in a coarse-pointer override to 44px, as the
  others do, so all five agree the *touch* size; only the fine-pointer size disagrees).

## F14 `width: calc(100% - 32px)` on the extension dialog's input: duplicated arithmetic, and it slips past the height/width guard
- `src/client/src/components/ExtensionDialogCard.ts:424-429` — `.dialog-input-form { display: grid }` / `.dialog-input { box-sizing: border-box; width: calc(100% - 32px); margin: var(--pi-space-6) var(--pi-space-7) 0; … }`
- Surface: any extension `dialog.request` input card.
- Finding: the input is a grid item in a container with no padding, and it already declares
  `margin-inline: var(--pi-space-7)` (16px each side). The 32px literal is a hand-spelled
  copy of `2 × --pi-space-7`, re-derived in a property the layout does not need it for — the
  grid item would simply stretch. Today the two agree by coincidence: change the margin token
  to `--pi-space-6` (or a theme overrides one) and the field stops 16px short of its own
  container with all the slack on the right, because `width` and `margin` are summed by the
  layout, not reconciled. `controlHeightScale`'s regex needs a px literal directly after the
  colon (`(?:min-)?(?:height|width):\s*(2[89]|3\d|4[0-4])px`), so `calc(100% - 32px)` is not
  even parsed.
- Minimal failure scenario: any retune of the horizontal gutter token silently de-syncs this
  one field from the option list and footer above and below it.
- Confidence: high on the mechanism, low on current visual impact (it is correct today).

## F15 The auth dialog's confirm button is a green wash; every other dialog's primary action is a solid accent fill
- `src/client/src/components/AuthDialog.ts:290` — `.actions button.primary { border-color: var(--pi-success-border); background: var(--pi-success-surface); color: var(--pi-success) }` (inherited 14px label)
- Siblings: `src/client/src/components/ExtensionDialogCard.ts:478` — `.primary-action { background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); font-weight: var(--pi-weight-strong) }`; settings footers use the selection tint as a *text* treatment, and QuickSwitcher's primary row uses the accent border + tint with tokenised text colour.
- Finding: two problems in one declaration. (a) Family drift — a filled control whose label
  colour is a *different* hue from its own fill is the only one of its kind; every other
  primary in the lane pairs one fill with one contrasting label token. (b) The label sits at
  `--pi-success` on `--pi-success-surface`, which is 6.8:1 in the shipped dark palette but
  carries no `--pi-on-*` contract: a theme that supplies the usual light pair
  (`--pi-success: #1a7f37`, `--pi-success-surface: #dafbe1`) lands at ~3.1:1 for a 14px
  label — under AA — and nothing in the token contract stops that, because the button does
  not name a label token. The comment at `index.html:145-146` records that this exact class
  of bug shipped once as "a 3.74:1 primary button" and the fix was `--pi-on-accent`; the
  success-tinted button was never brought into that contract.
- Minimal failure scenario: any plugin theme with a light palette opens the auth dialog; the
  "Submit"/"Continue" label is green on mint at ~3:1 and is the control you have to press.
- Confidence: medium (certain as a contract/family break; the AA failure is theme-dependent,
  since only the dark palette ships in-repo).

---

## Notes on what was checked and deliberately NOT reported
- **Catalogue rows indent 48px** (12 gutter + 24 checkbox + 12 button padding) against 12px
  group headers — standard checkbox-list pattern, and `ModelPicker.ts:306` pins the checkbox
  with tokens; reporting it would be taste, not geometry.
- **`Search providers` / `.search` field width** — looks like a UA-default 190px box, but the
  field is a flex item of `modal-surface`'s column container
  (`ModalSurface.ts:177` `display: flex; flex-direction: column`) so `align-items: stretch`
  makes it full-bleed. No defect.
- **`.settings-list button { min-height: 56px }`** (`SettingsDialog.ts:784`) — outside the
  guard's 28–44px window, but the two-line content computes to ~59px anyway, so the
  declaration never governs. Weak on its own; folded into F10's nav discussion.
- **`QuickSwitcher` `.row-tag { line-height: 16px }`** (`:500`) — a literal next to
  `font-size: var(--pi-text-2xs)`, but 16px is the ladder's own leading for that step, and
  the pill's `vertical-align: middle` centring against 14px text is correct. Not reported.
- **`×` / `›` glyph centring** in the close and chevron affordances: all five close buttons
  are `display: grid; place-items: center; line-height: 1`, which puts the glyph's ink
  centre within ~0.3px of the box centre at these sizes. Nothing to fix.
