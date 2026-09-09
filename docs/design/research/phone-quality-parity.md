# PI WEB — Phone-surface typography / rhythm / parity census (393×850)

Read-only source audit. Every value below is a literal from the current working tree
(HEAD `7f08d5c6`) with a `file:line` citation. Nothing in the repo was modified.

All pixel figures are **resolved px**, not token names. Token→px map is in §1.
"Reading edge" = distance from the left viewport edge to the first glyph of the
surface's primary text, at 393px width, arithmetic shown.

## 1. The declared scale (the thing everything else is supposed to match)

`src/client/index.html`:

| Token | px | Line |
|---|---|---|
| `--pi-text-2xs` | **11** | index.html:39 |
| `--pi-text-xs` | **12** | index.html:40 |
| `--pi-text-sm` | **13** | index.html:41 |
| `--pi-text-base` | **14** | index.html:42 |
| `--pi-text-md` | **15** | index.html:43 |
| `--pi-text-lg` | **17** | index.html:44 |
| `--pi-text-xl` | **20** | index.html:45 |
| `--pi-weight-regular` | 400 | index.html:48 |
| `--pi-weight-medium` | 500 | index.html:49 |
| `--pi-weight-semibold` | 600 | index.html:50 |
| `--pi-weight-strong` | **650** | index.html:53 |
| `--pi-space-3 / 4 / 5 / 6 / 7 / 9` | 6 / 8 / 10 / 12 / 16 / 24 | index.html:32–38 |
| `--pi-control-height` (compact) | 32 | index.html:96 |
| `--pi-control-height-comfort` | 36 | index.html:97 |
| `--pi-control-height-touch` | 44 | index.html:98 |
| `--pi-control-font-size` | **16** (iOS autofill/zoom guard, text inputs only) | index.html:135 |
| `--pi-row-min-height` | 56 | index.html:86 |
| `--pi-panel-header-height` / `--pi-panel-header-control-height` | 44 / 44 | index.html:90, 91 |
| `--pi-chrome-inset` | 6 | index.html:83 |
| `--pi-chat-gutter` | 16 desktop → **6 at ≤640px** | index.html:80, 199 |
| `--pi-chat-measure` | 100% | index.html:79 |
| `--pi-radius-sm / md / lg / xl / pill` | 6 / 8 / 12 / 16 / 999 | index.html:56–63 |
| `--pi-checkbox-size` | 24 | index.html:104 |
| `--pi-control-font-family` / `--pi-control-monospace-font-family` | `--pi-font-ui` / `--pi-font-mono` | index.html:136, 137 |
| `--pi-font-display` | SF Pro Display / Segoe UI Variable Display / Inter | index.html:133 |
| `--pi-rail-width` | **never declared**; used as `var(--pi-rail-width, 3px)` | shared.ts:419 |

Mobile media queries that actually change geometry:
- `@media (max-width: 640px)` index.html:199 — `--pi-chat-gutter` 16→6. The
  `--pi-chrome-inset` half of that declaration is a **no-op** (already 6px at :83).
- `@media (max-width: 760px)` — `MOBILE_NAVIGATION_MAX_PX = 760` (breakpoints.ts:23,
  media query :31); hides word-only list headings (shared.ts:295–305); shrinks
  PromptEditor footer to 8/6 (PromptEditor.ts:177–178); collapses Settings to one
  column and full-bleeds the dialog (SettingsDialog.ts:781–799).
- `@media (max-width: 430px)` — shrinks type/control sizes further.
- `@media (pointer: coarse)` / `COARSE_OR_MOBILE_MEDIA_QUERY` (breakpoints.ts:40) —
  raises hit targets to the 44px floor. **Not** the same set as `max-width: 760px`,
  which is why several "phone" numbers below have two values.

## 2. Comparison table — all 24 phone surfaces

| # | Surface (file) | Phone left reading edge (393px) | Row / item height | Distinct font sizes | Weights | Vertical rhythm | Card vs full-bleed |
|---|---|---|---|---|---|---|---|
| 1 | Boot / first paint on phone = compact nav panel (PiWebApp.ts:3797; AppNavigationPanel.ts:139; appShellController.ts:27) | **6px** header (`--pi-chrome-inset` AppNavigationPanel.ts:467); **19px** tool rows (10 section + 1 border + 8 pad, :474,:476); **16px** context chips (6 + 10, AppContextSwitcher.ts:98) | header 44 (:457,:467); chips 44 (AppContextSwitcher.ts:104); `.compact-scope` 44 (:485); `.tool-row` **52** (:476) | 11 (AppContextSwitcher.ts:109), 12 (:468 header actions), 14 (inherited `--pi-text-base` from PiWebApp.ts:128 — `.tool-label` :483 and `.compact-scope` :485 set no size), 17 (AppContextSwitcher.ts:116 glyph) | 400, 600 | chips gap 6 (:98); tools grid gap 8 (:474); `10px 10px calc(10px + safe-area)` (:474) | chrome full-bleed; tool entries are bordered cards (radius 12, 1px, :476) |
| 2 | Sessions list — rows (SessionList.ts:185 `.list-body`; shared.ts:372,:379) | **23px** = 10 section (shared.ts:274) + 3 rail (`--pi-rail-width, 3px` fallback shared.ts:419) + 10 `--pi-space-5` (`shared.ts:379`) | **56** (`--pi-row-min-height` shared.ts:379); `.tiles` variant → **80** (shared.ts:322) | 11 (`small` shared.ts:455), 12 (shared.ts:223; SessionList.ts:692,:700), 14 (`:host` shared.ts:251) | 400 (child rows SessionList.ts:752), **650** (unread `--pi-weight-strong` :715) | rows `margin: 6px 0` (shared.ts:372); section `padding: 10px`→top 6px ≤760 (shared.ts:274,:296) | **cards** — 1px border, radius 8, `--pi-surface`, + 3px left rail (shared.ts:372,:419) |
| 3 | App context bar (AppContextBar.ts:73–87) | **6px** (`--pi-chrome-inset` :73) | 44 bar (:73); toggle 44 (:75); title 44 (:79); `.working` 44 (:87) | 14 title, 12 chip | 400, 500 (:80), **650** title (`--pi-weight-strong` :79) | single 44px row; `padding: 0 6px` (:73) | full-bleed bar, 1px bottom border |
| 4 | Context chips (AppContextSwitcher.ts:97–116) | **6px** bare; **16px** nested in nav (6 + 10) | `.seg` min-height 44 (:104) | 11 (:109), 13 (:110,:111), 17 glyph (:116) | 400, 600 (:111) | `padding: 8px 10px` (:98), gap 6 (:98) | bordered pills, radius 12 (:104) |
| 5 | Chat transcript — message cards (ChatView.ts:205,:278) | **19px** = 6 gutter (index.html:199) + 1 border + 12 card pad (`--pi-space-6` :278) | content-driven; no row min-height | 11 (:408 `.msg-meta`; :154,:160 drawer tabs; :250 elapsed), 12 (:45 all buttons; :236,:324,:331,:334), 14 (:71 `:host`), 17 (:107 icon glyph) | 400, 600 (`--pi-weight-semibold`, the only weight ChatView sets); markdown `**bold**` renders at UA **700** — `formattedTextStyles` (`shared.ts:467+`) declares no `b`/`strong`/`font-weight` | `.msg` margin-bottom 16 (`--pi-space-7` :278); `.chat` pad 24/6/12 (:205) | **cards** — 1px, radius 12, `--pi-surface-card`, `max-width: --pi-chat-measure` = 100% (:278; index.html:79) |
| 6 | Tool execution cards (ToolExecutionView.ts:137–168) | **17px** = 6 + 1 border + **10** card pad (`--pi-space-5` :137) → 2px left of chat text | content-driven; no min-height | 12 (:144,:148,:152,:156,:158,:160,:161,:166), 13 (:142,:143) | 400, 600 | header margin-bottom 8 (:138); gap 8 (:137); detail blocks margin-top 8 (:156,:158) | **cards**, radius 8 (:137), bg `--pi-bg` (:137) — chat cards use `--pi-surface-card` |
| 7 | Composer / PromptEditor (PromptEditor.ts) | textarea **15px** = 6 + 1 border (shared surface) + 8 pad (`--pi-space-4` :90); collapsed bar **10px** (`--pi-space-5` :64 — *not* `--pi-chat-gutter`); footer buttons **6px** (:178) | textarea min-height 54→40 ≤760 (:89,:96); `.expand-composer` 44 (:65); `.icon-button` 36→44 COARSE (:80,:200); `.select-model` 36→44 (:76,:202) | 11 (:185 ≤430), 12 (:174), 13 (:65,:187), **16** textarea (`--pi-control-font-size` :89) | 400, 600 | footer pad 12/16 desktop → **8/6** ≤760 (:61,:178); collapsed 6/10 (:64); gap 8 (:61) | bordered composer card inside full-bleed 6px footer band |
| 8 | Chat top drawer (ChatView.ts:120–173) | **6px** (`0 var(--pi-chat-gutter)` :130) | `.drawer-header` 44 (:130); `.drawer-tab` **22** → 44 COARSE (:154,:173) | 11 (:154,:160) | 600 | tab strip; 60vh max + sticky header on mobile | full-bleed, purple-tinted `color-mix(... --pi-purple 7% ...)` (:120) |
| 9 | Status bar (StatusBar.ts:12,:13) | **14px** = 6 gutter + 8 pad | 12px line box only; no min-height | 12 | 400 | `padding: 8px var(--pi-chat-gutter)`, gap 12, border-top; `justify-content: flex-end` | full-bleed |
| 10 | Settings — phone master list (SettingsDialog.ts:781–789) | **16px** (`padding: 10px 16px` :786) — but header text is 12px (:783) | rows 56 (`--pi-row-min-height` :786); `.settings-back` 44 (:798) | 12 eyebrow (:765), **13** row `small` (:789), 14 back (:798), **17** row `strong` (:788), 20 h1 (:766) | 400, 600 (`--pi-weight-semibold` is the only weight declared, 3 rules incl. :788) | list `padding: 6px 0 calc(12px + safe)` (:785); full-bleed `border-bottom` separators (:786) | **full-bleed**, `border-radius: 0` (:786) |
| 11 | Settings — detail panels (SettingsDialog.ts:799 + SettingsPanelFrame.ts:97–116) | **12px** (`--pi-space-6`; `.settings-content` :799, `.panel` has no padding SettingsPanelFrame.ts:97) | controls 32 → 44 COARSE (settingsControlStyles.ts:6–21) | 11 `small` (shared.ts:455 / per-panel 2xs), 12 label/heading/desc/`code`/hint, 13 GeneralPanel `h3`, 14 FleetSection `h3`, **15** PackagesPanel `h3`, **17** frame `h2`, 20 `h1` | 400, 600, 700 | content gap 16 (`--pi-space-7` SettingsPanelFrame.ts:116); heading margin-bottom 16 (:98); card gap 16/12; `.field` gap 8 (SettingsGeneralPanel.ts:275) | **cards** — `.settings-card` 1px, radius 12, **pad 12** (SettingsGeneralPanel.ts:264) |
| 12 | Context sheet (ContextSwitcherSheet.ts:82–105) | **8px** (`.sheet` pad 8, :83); `.row` text 8 + 10 = 18 (shared.ts:207) | `.sheet-header` **content-driven — no min-height** (:84); `.sheet-close` 36→44 COARSE (:87); `.row` 32→44 COARSE (shared.ts:207) | 11 (shared.ts:455), 12 (shared.ts:223), 14 (:82 `:host`) | 400, 600 | body gap 8 (`--pi-space-4` :90); sheet pad 8 (:83) | cards (interactiveSurfaceStyles) |
| 13 | Quick switcher (QuickSwitcher.ts:393–526) | **23px** row title = 0 backdrop + 10 body (:405) + 1 border (:412) + 12 pad (`--pi-space-6` :412); input **21px** (10 + 1 + 10); `h3` 10 | row **56** (:412); input 36 (:401); `.machine-tab` 36→44 (:445); `.chip` 36→44 (:454,:493); row-menu 36→44 (:482) | 11 (`.row-tag` :507), 12 (:406 `h3`, :424 `.row-subtitle`, :457 `.chip.nested`, :474), 13 (`.machine-tab` :445, `.chip` :454), **15** `.row-title` (:423), **17** input (:401), 20 close (:404) | 400, **600** (:406, and `--pi-weight-strong` = **650** :426,:428) | rows gap 6 (:411); body pad 10 (:405); header pad 10 (:400) | **tile grid** `minmax(240px,1fr)` (:411) → `minmax(140px,1fr)` ≤430 (:519) |
| 14 | Model picker (ModelPicker.ts:276–312) | **32px** option text = 20 gap (`100vw − 40px` :279) + 12 pad (:301); search text **43px** = 20 + 12 margin (:288) + 1 border + 10 pad; group label 32 | option no desktop min-height → **~37**, 44 COARSE (:298); search 36→44 (:288,:297); scope 36→44 (:282,:295) | 11 (`small` :311), 12 (`--pi-text-xs` `font:` shorthand :310), 13 (:301,:309), 14 (:277 `:host`), **16** search (:288), 20 close (:287) | 400, 600 | search margin 10/12 (:288); scope margin `10px 12px 0` (:281); `.options` pad 0 (:284) | **full-bleed**, 1px border-bottom (:301,:309); group header pad 8/12/4 (:310) |
| 15 | Thinking picker = CommandPicker (CommandPicker.ts:104–130) | **32px** option = 20 + 12 (:117); search **43px** (20 + 12 margin + 1 + 10, :114) | option ~37 → 44 COARSE (:129); input 36→44 (:114,:128) | 11 (`small` :121), 13 (:117), 14 (:104), 16 search (:114), 20 close (:113) | 400, 600 | input margin 10/12 (:114); `.options` pad 0 (:108) | full-bleed border-bottom (:117) |
| 16 | Action palette (ActionPalette.ts:102–131) | **32px** option = 20 backdrop sides (:103) + 12 pad (:113); search **38px** = 20 + 10 header + 8 input pad (:104,:105) | option **no min-height, incl. COARSE** → ~37 (:113); close 36→44 (:110,:111) | 12 (`.group` :122), 14 (`button { font: inherit }` :109 → `:host` :102), **16** search (:105), 20 close glyph (:110) | 400, 600 | header pad 10 (:104); `--palette-top: min(12dvh, 90px)`, `--palette-bottom: max(20px, safe)` (:103) | full-bleed border-bottom (:113); COARSE hides `kbd` (:129) |
| 17 | Add-project dialog (ProjectDialog.ts:329–378) | **12px** labels/body (`--pi-space-6` :332); input text **23px** = 12 + 1 border + 10 pad (`--pi-space-5` :334); labels/error 12px (:332, :350); hint 11px@12px or 14px@24px by tag (:343 vs :347, render :302/:304) | input 32→44 (:334,:361); suggestion/footer button 32→44 (:337,:340,:360,:366); close 36→44 (:377,:378) | 11 (`small` via host listStyles shared.ts:455), **13 mono** (`.suggestions button` :340), 14 inherited (:376 `font: inherit`), **16 mono** input (:334), 20 close glyph (:377) | 400, 600 | body gap 12 / pad 12 (:332); label gap 6 (:333); header/footer pad 12 (:330) | modal full-bleed on phone (ModalSurface default `min(720px,100%)`, backdrop pad 0 — ModalSurface.ts:173,:177; PiWebApp.ts:3855); `.suggestions` = bordered box, radius 8 (:339) with **full-bleed border-bottom rows, radius 0** (:340) |
| 18 | Project / workspace list (ProjectList.ts:260–263 + shared listStyles) | **23px** (shared.ts:379) | 56 (shared.ts:379); **80** in `.tiles` mode (shared.ts:318,:322,:323); `.load-retry` **32, no coarse** (:263) | 11 (shared.ts:455), 12 (:223; ProjectList.ts:261,:263), 13 (ProjectList.ts:260,:262), 14 (shared.ts:251), **16** search (shared.ts:261) | 400, 600, 650 (shared.ts:365) | section 10; rows 56 + 6 margin; tiles gap 8 (shared.ts:309) | cards (shared.ts:372) / tiles radius **12** (shared.ts:318) |
| 19 | Session search (SessionList.ts:772,:773) | **21px** = 10 section + 1 border + 10 pad | 36 → 44 COARSE (:773,:788) | **16** (`--pi-control-font-size`) | — | `.session-search` sticky top 0 z-3 (:772); sits inside the 10px section padding | inset inside the card list |
| 20 | Empty state (PiWebApp.ts:142 + :193–194) | centred, indeterminate | button 44 (:194) | **13** (:194) | 400 | gap 10 (:193); pad 16 (:142) | dashed 1px card, radius 12 (:142) |
| 21 | `jump-to-bottom` (ChatView.ts:99–110) | overlay | **36 × 36 — no COARSE override** (:100–101) | 17 (glyph :107) | — | `--pi-layer-sticky`, `--pi-elevation-2` | floating circular button, radius pill |
| 22 | `.msg-meta` per-message actions (ChatView.ts:408,:415–419) | overlay | **24 × 24 visible** (:417,:418) — 44×40 effective hit box only via `::after { inset: -10px -8px }` (:419) | 11 (:408, silenced by `font-size: 0` :417) | — | `max-width: var(--pi-space-9)` = 24px (:415) | icon button |
| 23 | `queued-clear-button` / `history-load-button` (ChatView.ts:334,:326; COARSE :345,:346) | follows chat gutter 6 | 12px text row → **44 COARSE** | 12 | 400 | inherits `.chat` padding | inline chips |
| 24 | Attachment / image overlays (ChatView.ts:343–344; PiWebApp.ts:329–346) | full-bleed | 44 close | — | — | 92v min preview | full-screen |

## 3. Inconsistencies, ranked by phone visibility

### Tier 1 — every phone session, visible without looking for it

1. **Six different left reading edges inside one transcript view.** Chat text 19px,
   tool cards 17px, composer textarea 15px, status bar 14px, composer collapsed bar
   10px, footer buttons 6px (`ChatView.ts:278`; `ToolExecutionView.ts:137`;
   `PromptEditor.ts:90`, `:64`, `:178`; `StatusBar.ts:12`). One card's padding token
   differs and the whole column steps sideways.
2. **SessionList jump-indents 23 → 51 → 63px.** Flat row 23px; adding a subtree
   toggle costs `--pi-row-gutter-start + --pi-row-gutter-size + --pi-space-4` =
   38px fine / 50px coarse on top of section+rail (`shared.ts:274`, `:419`, `:379`;
   `SessionList.ts:682`, `:683`, `:746`, `:762`). At 393px the coarse case burns
   **16% of viewport width** before a glyph appears.
3. **Pickers park phone text 32–43px from the edge.** Model/Thinking pickers size to
   `min(720px, calc(100vw − 40px))` — a desktop margin that survives to 393px
   (`ModelPicker.ts:279`, `CommandPicker.ts:106`) — then add 12px option padding
   (`:301` / `:117`) and 12+1+10px around search (`:288` / `:114`). ActionPalette
   matches 32px with `--modal-surface-backdrop-padding: … 20px …`
   (`ActionPalette.ts:103`, `:113`). Quick switcher is the only picker that collapses
   to 0 backdrop (`QuickSwitcher.ts:396`) — the opposite choice.
4. **Three font sizes for the same settings element `h3`: 13 / 14 / 15px**
   (`SettingsGeneralPanel.ts:258`, `SettingsFleetSection.ts:110`,
   `SettingsPackagesPanel.ts:189`).
5. **Two touch/viewport systems disagree.** `.drawer-tab` only reaches 44px under
   `pointer: coarse` (`ChatView.ts:173`), while `max-width: 430px` shrinks
   PromptEditor buttons (`PromptEditor.ts:184–191`). A 760px-wide touch device gets
   one set, a 430px mouse device the other.
6. **Settings card padding diverges: 12 vs 10 vs 8.** `.settings-card` 12
   (`SettingsGeneralPanel.ts:264`), `.theme` 10 (`SettingsAppearancePanel.ts:125`),
   `.machine-card` 10 → **8** at ≤760 (`SettingsMachinesPanel.ts:106`, `:124`), while
   General's 12 never narrows (its ≤760 block only reflows the `dl`,
   `SettingsGeneralPanel.ts:290–292`). Card-body edges: 25 / 23 / 23 → **21** on phone.
7. **Nine distinct row/control heights in the same UI: 22, 32, 36, ~37, 44, 52, 56, 74, 80.**
   22 `ChatView.ts:154`; 32 `index.html:96`; 36 `:97`; ~37 = 10+13×1.25+10
   (`ModelPicker.ts:301`, `CommandPicker.ts:117`, `ActionPalette.ts:113`); 44 `:98`;
   **52 = `calc(touch + space-4)`, a one-off** (`AppNavigationPanel.ts:476`);
   56 `index.html:86`; 74 `.preview` (`SettingsAppearancePanel.ts:145`);
   **80 = `calc(--pi-row-min-height + --pi-space-9)`** (`shared.ts:322`).
8. **Composer textarea is 16px; every other glyph on screen is ≤15px.** Deliberate
   iOS guard (`PromptEditor.ts:89`; `index.html:135`) but it renders as a type-size
   discontinuity in the one field users touch most.
9. **Settings header vs phone list are 4px apart on the same screen** — header 12px
   (`SettingsDialog.ts:783`) vs list text 16px (`:786`) — and the back button pulls
   to 4px with `margin-left: calc(-1 * var(--pi-space-4))` (`:798`).
10. **Two search inputs inside the sessions panel: 21px vs 16px**
    (`shared.ts:261` → `SessionList.ts:772–773` vs `.row` padding `shared.ts:207`).
11. **Settings list rows are the largest type in the app** — 17px/600 primary
    (`SettingsDialog.ts:786`) — bigger than the settings `h2` (17/400,
    `SettingsPanelFrame.ts:101`) and bigger than chat body text (14px).

### Tier 2 — visible as soon as you open a second surface

12. **Six sizes for secondary text (11 / 12 / 13 / 14) across siblings.** Pickers use
    13 for options (`ModelPicker.ts:301`, `CommandPicker.ts:117`), the palette uses
    **14** for the identical job (`ActionPalette.ts:109`, `:113`).
13. **`small` is 11px only when `listStyles` is mounted** (`shared.ts:455`). In
    ActionPalette, `small` is unstyled (`:120`) and resolves to the UA default —
    a seventh secondary size that differs per component by accident.
14. **Quick switcher uses 17px for its search field and 15px for row titles**
    (`QuickSwitcher.ts:401`, `:423`) — both larger than chat body, both absent from
    every other list-like surface (`--pi-text-md`, `--pi-text-lg`, index.html:43–44).
15. **Five radius scales for one row (4 / 6 / 8 / 12 / 999).** Session rows 8
    (`shared.ts:372`), tiles + sheets + tool rows 12 (`shared.ts:318`,
    `AppNavigationPanel.ts:476`, `QuickSwitcher.ts:412`), composer 12
    (`PromptEditor.ts:89`), `.jump-to-bottom` pill (`ChatView.ts:105`), settings
    phone rows 0 (`SettingsDialog.ts:786`).
16. **`.jump-to-bottom` stays 36px on a phone.** It is the only phone-primary control
    with no coarse-pointer override (`ChatView.ts:99–110`; the COARSE block at
    `:343–350` lifts `.command-dismiss`, `.image-zoom-close`,
    `.queued-clear-button`, `.history-load-button` — not this).
17. **`.msg-meta` is a 24px visible target** (`ChatView.ts:417–418`); 44px exists only
    as an invisible `::after` box (`:419`). Any visual touch-target audit fails it.
18. **ActionPalette options never reach the touch floor** — COARSE block only hides
    `kbd` and re-columns (`ActionPalette.ts:128–131`); `.options button`
    (`:113`) has no min-height anywhere, ≈37px.
19. **`ProjectList` `.load-retry` is 32px with no COARSE override**
    (`ProjectList.ts:263`), unlike `--pi-control-height-touch` elsewhere.
20. **Settings inputs don't inherit the iOS 16px guard.**
    `SettingsGeneralPanel.ts:277` hard-codes `--pi-control-font-size`; the shared
    `settingsControlStyles.ts` (22 lines) sets no font-size at all, and
    `SettingsMachinesPanel.ts:67` / `SettingsPackagesPanel.ts:75` set none → they
    inherit 14px and **iOS Safari will zoom on focus** in exactly those two panels.
21. **Monospace inputs leak into text-entry surfaces.** The project-path field uses
    `--pi-control-monospace-font-family` (`ProjectDialog.ts:334`) and
    `SettingsGeneralPanel.ts:279` uses it for prose textareas, while the shell's rule
    is `--pi-control-font-family: --pi-font-ui` (index.html:136).
22. **Tool cards use `--pi-bg`, chat cards use `--pi-surface-card`**
    (`ToolExecutionView.ts:137` vs `ChatView.ts:278`) — one transcript, two card
    tones, 2px apart horizontally.

### Tier 3 — real but only on a second screen

23. **Markdown bold is off the weight scale.** `formattedTextStyles`
    (`shared.ts:467`+) declares no `b`/`strong` rule, so `**bold**` in an assistant
    message resolves to the UA default **700** while every deliberate emphasis in the
    app is 600 (`--pi-weight-semibold`) or 650 (`--pi-weight-strong`, index.html:50,:53).
24. `--pi-chrome-inset` mobile override is dead code (identical at index.html:83 and :199).
25. `--pi-rail-width` is consumed but never declared (shared.ts:419) — the session rail
    silently rides a 3px fallback.
26. `.session-search-input` re-declares its 16px font at ≤760 and again under COARSE
    (SessionList.ts:773, :782, :827).
27. Quick switcher carries two coarse blocks (`:489–495`, `:521–526`); PromptEditor
    also carries two (`:162–175`, `:199–204`).
28. `--pi-chat-measure: 100%` (index.html:79) — messages fill the column with no
    measure cap at any width, so `.msg { max-width: var(--pi-chat-measure) }`
    (`ChatView.ts:278`) never binds.
29. ProjectDialog re-declares `footer button { min-height: touch }` twice inside the
    same COARSE block (`ProjectDialog.ts:360` and `:366`).
30. **Two emphasis weights used interchangeably.** `QuickSwitcher.ts` uses
    `--pi-weight-semibold` (600, `:406`) and `--pi-weight-strong` (650, `:426`, `:428`)
    in the same component for the same job; the two tokens differ by 50 (`index.html:50`, `:53`).
31. **One dialog, two hint geometries.** `ProjectDialog` renders `<small class="hint">`
    (`:302`) and `<div class="hint">` (`:304`, `:310`, `:311`) with the same class.
    `.hint` carries `padding: var(--pi-space-6)` (`:343`) and `small` is clamped to
    11px by the host `listStyles` (`shared.ts:455`), while `small.hint` resets that
    padding to 0 (`:347`) — so the identical sentence renders at **11px / 12px edge**
    or **14px / 24px edge** depending on which tag was typed.
32. `ContextSwitcherSheet`'s `.sheet-header` is the only header with no `min-height`
    (ContextSwitcherSheet.ts:84), while every other bar pins 44
    (AppContextBar.ts:73, AppNavigationPanel.ts:457, index.html:90).

## 4. Checked and *not* a problem

- Both headers pin 44px: `AppContextBar.ts:73`, `AppNavigationPanel.ts:457`.
- Session rows are cards everywhere — 1px border, radius 8, 6px vertical margin
  (`shared.ts:372`); no card/full-bleed mix within the list.
- Settings detail is consistently card-grouped (1px, radius 12, 12px pad, 12px gap —
  `SettingsGeneralPanel.ts:264`, `:265`).
- Settings phone master list is consistently full-bleed (`border-radius: 0` +
  border-bottom, `SettingsDialog.ts:786`).
- 16px is applied correctly for text inputs in `PromptEditor.ts:89`,
  `SettingsGeneralPanel.ts:277`, `SettingsShortcutsPanel.ts:391`,
  `shared.ts:261`, `SessionList.ts:773`, `ModelPicker.ts:288`,
  `CommandPicker.ts:114`, `ActionPalette.ts:105`, `ProjectDialog.ts:334`.
- The session rail is intentional: `shared.ts:419` follows `shared.ts:372` in the
  same stylesheet, so the 3px left rail always applies. Not a defect.
- Reduced motion is handled where it matters: blanket resets in `listStyles`
  (`shared.ts:232`), `workspacePanelStyles` (`shared.ts:148`), `ChatView.ts:52`,
  `PromptEditor.ts:41`, `PiWebApp.ts`, `AppContextBar.ts`. The pickers, dialogs and
  tool cards that lack such a block (`QuickSwitcher.ts`, `ModelPicker.ts`,
  `CommandPicker.ts`, `ActionPalette.ts`, `ToolExecutionView.ts`,
  `ContextSwitcherSheet.ts`, `ProjectDialog.ts`, `SettingsDialog.ts`) declare **zero**
  `transition`/`animation` rules, so nothing escapes the policy.

## 5. Could not settle from source alone

- **Effective keyboard height at 393×850.** Composer min-heights are `min(15vh, 110px)`
  desktop / `min(12vh, 84px)` ≤760 (`PromptEditor.ts:95`, `:96`), which on 850px
  viewport is 102px / 84px, but the transcript's visible height after the keyboard is
  a runtime measurement.
- **Computed `font-family` for `--pi-font-ui` / `--pi-font-mono`**
  (index.html:130–137) depends on installed fonts; mono-vs-sans drift between the
  composer and the project-path field is measurable in source but its rendered width
  delta is not.
- **`.list-body.tiles` (shared.ts:309–327) reachability on phone.** The 80px tile
  variant is wired to a plugin capability flag (`src/client/src/plugins/types.ts:224
  readonly tiles: boolean`); which phone-resident list actually turns it on is a
  runtime/plugin decision, not visible in the shell source.
- **Document-level font fallback.** `html, body` (index.html:201–202) sets colours
  but no `font`, `font-size` or `font-family`; the 14px/`--pi-font-ui` baseline comes
  only from `PiWebApp`'s `:host` (`PiWebApp.ts:128`). Anything rendered in the
  document light DOM rather than inside that shadow root inherits the browser UA
  default (16px serif) — whether anything renders there is a runtime question.
- **Safe-area contribution.** `env(safe-area-inset-bottom)` appears in
  `ActionPalette.ts:103`, `SettingsDialog.ts:785`, `AppNavigationPanel.ts:474` but not
  in `PromptEditor.ts:178` or `ChatView.ts:205` — whether that is a real gap at
  393×850 depends on device inset values.
