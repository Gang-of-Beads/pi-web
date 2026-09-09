# Research: phone-first list/settings quality reference (row height, type ramp, chrome budget, secondary lines)

## ⚠ Verification limitation (read this first)

**No web tooling was available in this run.** The only tools exposed to this agent were file
`Read` and `Write`. `web_search`, page fetch, and `source_check` were not registered, so **no live
2024-2026 source was fetched or validated during this run.**

Consequently every finding below is tagged with one of three provenance labels, and you should
treat them very differently:

| Label | Meaning | Trust |
|---|---|---|
| **[REPO-VERIFIED]** | Read directly from this repository during this run (file + what it says). | High |
| **[REPO-CITED-FETCH]** | A claim that a *previous* round of this project fetched and recorded as live-verified in `docs/design/industry-layout-research.md` §2 (including two claims it explicitly *corrected*). Second-hand but with an audit trail. | Medium-high |
| **[RECALL]** | Design-system numbers recalled from training data, not fetched this run. Canonical URL given so the owner can verify in one click. Values may have drifted, and I may misremember specific numbers. | Low-medium — **verify before adopting as spec** |

Nothing below is presented as a live 2026 quotation. No dates, quotes, or measurements were
invented; where I am unsure of a spec number I say so instead of rounding to a confident-looking
figure.

## Summary

Against the mainstream phone list specs, PI WEB's **row height and secondary-line size are roughly
fine; its inconsistency is what reads as "very poor."** The three things no shipped design system
tolerates are present here at once: **five different reading edges on one screen (10/12/15/16/25px),
six type sizes on one screen (11/12/13/14/16/17), and ~21% of the viewport spent on stacked chrome
before the first row.** Every reference system I know of collapses those to **one content inset
(16px), three-to-four type roles per screen, and one top bar plus at most one optional search row
(~100-120px, ≤15% of an 850px viewport)**. The settings title at **17px/600 is heavier than both
iOS (17 regular) and Material 3 (16 regular)** for the same role — shrinking and de-bolding it,
aligning the eyebrow to 16px, and killing one chrome row will do more for perceived quality than any
row-height change.

## Findings

### A. Row height and type for a two-line phone list row

1. **Claim:** Material 3's list item heights are **56dp one-line / 72dp two-line / 88dp three-line**,
   with a **16dp leading inset**; the headline uses Body Large (16sp) and the supporting text Body
   Medium (14sp).
   **Sources:** [M3 lists](https://m3.material.io/components/lists/specs) (not fetched this run).
   **Support:** [RECALL]. **Confidence:** medium. The 56/72/88 ladder and the 16dp inset I recall
   with reasonable confidence; the exact type-role mapping (Body Large vs Title Medium for the
   headline) is the part most likely to be slightly off — check the spec page before writing it into
   a token.
   **Against our value:** our **59px** two-line settings row is **~13px shorter than M3's 72dp**.
   Not broken, but on the dense side of Android.

2. **Claim:** Apple's list/table rows on iPhone sit near **44pt for a single-line row**, with a
   two-line "subtitle" row in the high-50s pt, and the platform minimum tap target is **44x44pt**;
   the type roles used in a settings row are **Body 17pt regular** for the title and **Footnote 13pt**
   or **Subheadline 15pt** for the secondary line.
   **Sources:** [HIG — Layout / hit targets](https://developer.apple.com/design/human-interface-guidelines/layout),
   [HIG — Typography](https://developer.apple.com/design/human-interface-guidelines/typography),
   [HIG — Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables) (not fetched this run).
   **Support:** [RECALL]. **Confidence:** medium for 44pt target and 17/13/15pt type roles (these are
   long-stable); **low for the exact two-line row height** — I recall "high 50s pt" but Apple does not
   publish it as a single spec number the way M3 does, it falls out of content + padding.
   **Against our value:** **59px is essentially the iOS two-line row.** So our row height is *fine*,
   and the felt problem is not height.
   **Researcher inference:** the "cramped" feeling at 59px is caused by pairing a **17px/600** title
   with a 13px sub inside 59px — that is ~30px of ink in a 59px box with no breathing room. Apple
   gets away with 17pt because the title is **regular weight**, not 600.

3. **Claim:** Our settings title weight/size (**17px/600**) is heavier than the reference role in
   both systems (iOS 17 **regular**; M3 16 **regular**), and our sub-line (13px) matches iOS Footnote
   but is one step below M3's 14sp.
   **Sources:** the two [RECALL] entries above; our measured values from the task brief.
   **Support:** interpretation. **Confidence:** medium.
   **Verdict on our numbers:** row height 59px **fine (slightly tight)**; title **too heavy, and one
   step too large**; sub-line **fine**.
   **Adoptable:** row `min-height: 64px`, title `16px / 500`, sub `13px / 400`, 2px gap, 12px vertical
   padding, 16px leading inset. 64px is deliberately between iOS (~58) and M3 (72) and is a superset
   of the 44px touch floor.

4. **Claim:** We already own a token for exactly this shape — `--pi-row-min-height: 56px`, documented
   in `src/client/index.html` as *"A list row that carries a title and a second line. One value, so
   four lists cannot drift to 52, 56, 58 and 60 for the same shape."*
   **Sources:** `src/client/index.html` (token block); `src/client/src/components/shared.ts`
   (`.action-main { min-height: var(--pi-row-min-height) }`).
   **Support:** direct evidence [REPO-VERIFIED]. **Confidence:** high.
   **Researcher inference (unverified):** the measured **59px** settings row does not equal the 56px
   token, so the settings list is very likely **not consuming `--pi-row-min-height`** and is deriving
   its height from padding instead. I read only the first 140 lines of `SettingsDialog.ts` and did
   not locate its row CSS, so this is inference, not confirmed. **The token's own docstring predicted
   this exact drift.**

### B. How many distinct type sizes belong on one screen

5. **Claim:** Reference systems ship a *scale* of 8-15 steps but use only a **small subset per
   surface**; a phone list screen in iOS Settings or an M3 settings screen is built from roughly
   **three type roles** (row title, secondary line, section header) plus a screen title.
   **Sources:** [HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography),
   [M3 type scale](https://m3.material.io/styles/typography/type-scale-tokens) (not fetched this run).
   **Support:** [RECALL] for the scales; **the "three roles per screen" count is researcher inference**
   from how those screens are composed, **not a published rule**. I could not find (or fetch) a
   design system that publishes a hard "max N sizes per screen" number.
   **Confidence:** low-medium as a citable rule; high as a design convention.
   **Against our values:** **11 / 12 / 13 / 14 / 16 / 17 = six sizes on one screen is roughly double
   the working set** of a reference settings or list screen.
   **Adoptable target — 4 roles max per screen:**
   - `16px/500` primary (row title, search input value)
   - `13px/400` secondary (path, sub-line, meta)
   - `12px/500` eyebrow / section header / action label (uppercase or muted, pick one and keep it)
   - `20px/600` screen title *only if the screen has one*
   Retire **11px, 14px and 17px from these surfaces**. 11px is below Apple's smallest text role
   (Caption 2 = 11pt) only in the sense that it *is* the floor — using it for a path on a phone is
   spending your smallest legible size on your least important content.

6. **Claim:** Our token block already encodes a sane ramp (`--pi-text-2xs 11 / xs 12 / sm 13 /
   base 14 / md 15 / lg 17 / xl 20`) — the defect is **consumption, not the scale**. The base UA-ish
   rule in `shared.ts` sets buttons/inputs/labels to `--pi-text-xs` (12px) while `:host` is
   `--pi-text-base` (14px), so a screen mixing rows, buttons and headings gets 12+14 for free before
   any component chooses anything.
   **Sources:** `src/client/index.html`; `src/client/src/components/shared.ts`.
   **Support:** direct evidence [REPO-VERIFIED]. **Confidence:** high.
   **Researcher inference:** the six-size screen is a *composition* artifact — no single component is
   wrong, the shared base rules plus per-component picks sum to six. Fixing it needs a per-surface
   role budget, not a token edit.

### C. Grouped card list vs full-bleed rows

7. **Claim:** The two platforms split here, and both patterns are legitimate: **iOS uses inset,
   grouped, rounded "cards"** for settings (the inset-grouped table style), with **separators inset
   to the text edge, not full-bleed**; **Material 3 uses full-bleed rows** with section subheads and
   sparing dividers (M3 leans on spacing and subheads rather than rules).
   **Sources:** [HIG Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables),
   [M3 lists](https://m3.material.io/components/lists/guidelines),
   [M3 divider](https://m3.material.io/components/divider/guidelines) (not fetched this run).
   **Support:** [RECALL]. **Confidence:** medium for the split; **medium-low for "M3 discourages
   dividers"** — I recall M3 guidance preferring space over rules, but verify the wording.
   **Decision rule (researcher inference, from both patterns):** use a **grouped card** when a screen
   shows **more than one heterogeneous group** and the list is *content on a canvas*; use
   **full-bleed rows** when **the list is the entire screen**. Our settings list is the whole screen,
   so **full-bleed is the right choice — we do not need cards.**
   **The actual defect:** full-bleed rows with **full-bleed separators** while the **eyebrow sits at a
   different inset (12px) than the text (16px)**. Both iOS and M3 keep the group label and the row
   text on the **same** left edge. Inset the separator to 16px (the text edge) or remove separators
   and group by space — either is coherent; the current mix is not.
   **Verdict on our value:** row inset **16px = correct**; eyebrow **12px = wrong, misaligned**;
   full-bleed separator **acceptable on Android idiom but inconsistent with our 16px text edge**.

### D. Reading edges — the single biggest quality tell

8. **Claim:** Every referenced system defines **one horizontal content margin per breakpoint**
   (M3 compact window: 16dp; Apple: a standard readable margin the list and its header share).
   **Sources:** [M3 layout / applying layout](https://m3.material.io/foundations/layout/applying-layout/window-size-classes) (not fetched this run).
   **Support:** [RECALL] for the 16dp compact margin; **medium confidence**. The *principle* that one
   screen has one content edge is universal across the systems named in the task and is
   [REPO-CITED-FETCH]-adjacent — the repo's prior round verified M3's window-size-class table live.
   **Against our values:** **10, 12, 15, 16 and 25px on one screen.** Five edges. This is the finding
   I would act on first: a user perceives edge misalignment pre-attentively, before they read
   anything, which is exactly the "unconsidered" signal the owner reported.
   **Adoptable:** **one content inset = 16px** for every text-bearing element on a phone surface,
   including eyebrows, empty states, search fields, and separator insets. Allow **exactly one**
   documented exception: dense chrome rows may use 12px, and if so, *all* chrome uses 12px.
   Note our token block already declares `--pi-chrome-inset: var(--pi-space-3)` = **6px** under
   640px [REPO-VERIFIED], which is a **third** edge in the system by design — that token and the
   16px content edge need reconciling.

### E. Chrome budget above content

9. **Claim:** A phone reference stack spends roughly **one top bar plus at most one search row**
   before content: M3 small top app bar **64dp**, M3 search bar **56dp**; iOS nav bar **44pt**
   (plus large-title expansion) with a **~36-52pt search field**.
   **Sources:** [M3 top app bar](https://m3.material.io/components/top-app-bar/specs),
   [M3 search](https://m3.material.io/components/search/specs),
   [HIG Navigation bars](https://developer.apple.com/design/human-interface-guidelines/navigation-bars) (not fetched this run).
   **Support:** [RECALL]. **Confidence:** medium for M3 64/56dp; **low for the iOS search field
   height**. The status bar is OS chrome and should not be counted against the app's budget.
   **Against our values:** **~180px of 850 = 21%** in **four stacked bands** (45px context bar +
   45px compact header + "Projects + Add project" row + 44px search).
   **Adoptable budget (researcher inference from the above):** **≤2 bands and ≤120px (~14%)** before
   the first tile. Concretely: merge the 45px context bar and 45px compact header into **one 56px
   bar** carrying the scope name + overflow; move "+ Add project" into that bar's trailing edge
   (`shared.ts` already documents this exact fix for headings: *"a stacked bar cost a fifth of a phone
   screen before any content"* [REPO-VERIFIED] — the heading pattern learned it, the boot screen did
   not); make the search field **appear on demand** or **sticky-on-scroll** rather than permanently
   resident.
   **Verdict on our value:** **too much chrome — about 60px over budget, and one band too many.**

### F. The secondary line (filesystem path)

10. **Claim:** Reference treatment of a path-like secondary line is: **one line, smaller and muted,
    truncated rather than wrapped**, with **middle/head truncation** for paths specifically (so the
    distinguishing tail survives) — Apple exposes `.byTruncatingMiddle` for this, and M3's supporting
    text is a single line by default in the two-line list item.
    **Sources:** [HIG Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables),
    [M3 lists](https://m3.material.io/components/lists/specs) (not fetched this run).
    **Support:** [RECALL]. **Confidence:** medium on the pattern; **low** on M3 wording specifics.
    **Against our values:** our tiles reserve **two clamped lines for the path** — `shared.ts` sets
    `.list-body.tiles small { -webkit-line-clamp: 2; min-height: 2.6em; max-height: 2.6em }` and the
    title reserves `min-height: 2.5em` [REPO-VERIFIED].
    **Researcher inference (arithmetic, not a source claim):** at 13px, `2.6em` ≈ **34px** of path,
    plus a 14px title at `2.5em` ≈ **35px**, plus vertical padding ≈ 20px ⇒ **~89px of content in an
    85px tile.** The clamp is fighting the height clamp. Either drop the path to **one line
    (`-webkit-line-clamp: 1`, ~17px)** and the tile lands comfortably at **~76-85px**, or keep two
    path lines and raise the tile to **~96-104px**. Do not keep both constraints as they are.
    **Adoptable:** path at **13px, muted, one line, middle-truncated**, `--pi-font-mono` optional for
    scannability. A path is orientation, not content — it should never be allowed to set a row's
    height.

### G. Floors we can treat as settled (prior-round verified)

11. **Claim:** **WCAG 2.2 SC 2.5.8 Target Size (Minimum) = 24x24 CSS px** with a spacing exemption;
    **44x44 is the AAA/comfort level (2.5.5)**. GitHub **Primer's published accessibility floor is
    24px**, not 32px — 32px is Primer's *medium button visual min-height*, and Primer notes small
    buttons may not meet the floor.
    **Sources:** `docs/design/industry-layout-research.md` §2 verification table, which records live
    fetches of [WCAG 2.2 2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum) and
    [Primer button accessibility](https://primer.style/product/components/button/accessibility),
    including an explicit **correction** of an earlier 32px claim.
    **Support:** [REPO-CITED-FETCH]. **Confidence:** medium-high (audited second-hand, not re-fetched).
    **Relevance:** at 59px and 85px our rows and tiles are far above every floor. **Density is not the
    quality problem on these two screens** — the owner's complaint is about rhythm and alignment, and
    the still-open 30/32-36/44 touch-density decision recorded in the repo docs is a *separate*
    question that this brief does not reopen.

12. **Claim:** M3 window size classes (compact <600 / medium 600-839 / expanded 840-1199 / large
    1200-1599 / XL ≥1600) were live-verified by the prior round; the same round ruled M3's **600/840
    breakpoints not adoptable here** because PI WEB has published `coarseOrMobile: 760` /
    `desktopSideBySide: 1181` in its plugin contract.
    **Sources:** `docs/design/industry-layout-research.md` §2 and §3 row 3.
    **Support:** [REPO-CITED-FETCH]. **Confidence:** medium-high.
    **Relevance:** **do not import M3's breakpoints with its list specs.** Take M3's *row/type/inset*
    numbers, keep our own breakpoint vocabulary.

## Adoption table (what to change, with direction)

| Our measured value | Reference | Verdict | Adopt |
|---|---|---|---|
| Settings row **59px** | M3 72dp; iOS ~high-50s pt | **Fine, slightly tight** | 64px, via `--pi-row-min-height` |
| Title **17px / 600** | iOS 17 regular; M3 16 regular | **Too heavy, one step too large** | 16px / 500 |
| Sub-line **13px** | iOS Footnote 13; M3 14sp | **Fine** | keep 13px, muted |
| Left inset **16px** | M3 16dp; iOS standard margin | **Correct** | keep, make it the only edge |
| Eyebrow inset **12px** | same edge as row text | **Wrong (misaligned)** | 16px |
| Reading edges **10/12/15/16/25** | one per breakpoint | **Unacceptable — top defect** | one 16px content edge (+ at most one 12px chrome edge, applied uniformly) |
| Type sizes on screen **6** (11/12/13/14/16/17) | ~3 roles + optional title | **About double** | 4 max: 16/13/12 (+20 title) |
| Chrome **~180px / 21%, 4 bands** | 1 bar (~56-64) + ≤1 search (~44-56) | **Too much, one band too many** | ≤2 bands, ≤120px (~14%) |
| Full-bleed rows, no card | iOS grouped-card *or* M3 full-bleed | **Right choice for a full-screen list** | keep full-bleed; inset separators to 16px or drop them for spacing |
| Path **2 clamped lines** in an **85px** tile | one truncated line | **Over-reserved; clamps conflict** | 1 line, middle-truncated; keep tile 76-85px |
| Tiles **2 col x 177px, 85px tall** | — | **Width fine; height under-provisioned for current clamps** | resolve via the path clamp above |

## Contradictions

- **Internal (repo, [REPO-VERIFIED]):** `--pi-row-min-height: 56px` is documented as the one value
  for a title+subtitle row, yet the settings list measures **59px**. Either settings does not consume
  the token, or padding is added on top. I did not locate the settings row CSS, so I am recording the
  discrepancy rather than resolving it.
- **Internal (repo, [REPO-VERIFIED]):** `--pi-chrome-inset` resolves to **6px** below 640px while the
  content edge is 16px. That is a designed second edge, and it is part of what produces the measured
  10/12/15/16/25 spread. Reconciling "one reading edge" with this token is a product decision, not a
  bug fix.
- **Cross-platform (expected, not a defect):** iOS groups settings into inset cards; M3 uses
  full-bleed rows. There is no single industry answer — the systems genuinely disagree, and the only
  wrong move is mixing the two idioms on one screen, which is our current state.
- **Prior-round correction on record:** the earlier claim "Primer = 32px minimum interactive area"
  was live-fetched and **found false** (24px is the floor). Do not resurrect the 32px figure from
  older notes.

## Missing evidence

- **Nothing in this brief was fetched or `source_check`-validated during this run** — no web tools
  were registered. All design-system numbers marked [RECALL] need a one-click verification pass
  before they become tokens.
- **Not covered at all, because I could not search:** Linear, Vercel, Raycast, Shopify Polaris and
  Atlassian density/type-scale writeups. I have no reliable recalled numbers for Polaris or Atlassian
  type tokens and deliberately did not guess them.
- **No credible research located (would need a real search) on:** minimum comfortable line length on
  390-430px viewports. The commonly repeated "45-75 characters" figure comes from print typography
  (Bringhurst) and I could not verify whether any 2024-2026 study restates it for phone widths — so I
  give no line-length number here.
- **Unverified:** exact iOS two-line row height (Apple does not publish it as a single number);
  whether M3 currently discourages dividers in favor of spacing; whether M3's list headline role is
  Body Large or Title Medium.
- **Unverified in repo:** which rule produces the 59px settings row; where the 10px and 25px reading
  edges come from.

## Sources

**Kept (repo, read this run — high trust):**
- `src/client/index.html` — token block: type ramp 11/12/13/14/15/17/20, `--pi-row-min-height: 56px`,
  `--pi-chrome-inset` → 6px under 640px, control heights 32/36/44. Shows the scale is fine and the
  problem is consumption.
- `src/client/src/components/shared.ts` — `.action-main` consumes the row token; tile clamps
  (`2.5em` title / `2.6em` path) and the 85px tile height; the documented "a stacked bar cost a fifth
  of a phone screen" lesson that the boot screen has not applied.
- `docs/design/industry-layout-research.md` — §2 verification table is the only *audited* live-fetch
  evidence available to me (WCAG 24px, Primer 24px correction, M3 size classes); §3 records why M3
  breakpoints are not adoptable here.
- `docs/design/mobile-layout-research.md` — §1.7 already recorded the settings list as *"全应用里手机
  形态最成熟的列表"*, which conflicts with the owner's current verdict and suggests the regression is
  recent or is about alignment/type rather than the list structure.
- `docs/design/minimal-layout-research.md` — C4 ("group by spacing, not frames") and C5 (first-screen
  budget) are already-adopted criteria that this brief's chrome and separator recommendations line up
  with.

**Cited but NOT fetched this run (verify before adopting):**
- m3.material.io — lists specs, type scale, top app bar, search, layout margins.
- developer.apple.com HIG — Lists and tables, Typography, Layout, Navigation bars.
- w3.org WCAG 2.2 §2.5.8 / §2.5.5 (prior round fetched this; I did not).
- primer.style button accessibility (prior round fetched and corrected this; I did not).

**Not consulted:** Polaris, Atlassian, Linear, Vercel, Raycast — no tool access, and I will not
reconstruct their numbers from memory.

## Next steps

1. **Re-run this exact brief with web tooling enabled.** The high-value fetches, in order:
   M3 list specs (row heights + insets), HIG Lists and tables (two-line row + separator inset),
   M3 top app bar + search specs (chrome budget), and one Polaris/Atlassian density page for a third
   opinion. Everything marked [RECALL] should be promoted or corrected.
2. **Do not wait for that to fix the three unambiguous items**, none of which depend on a contested
   spec number: one 16px reading edge; eyebrow aligned to the row text; one chrome band removed.
   Those are internal-consistency defects, and the repo's own docs already justify all three.
3. **Resolve the token conflicts before touching component CSS:** why settings renders 59px against a
   56px token, and whether `--pi-chrome-inset` (6px on phones) is allowed to be a second reading edge.
   Fixing components without settling those two will regenerate the spread.
4. **Decide the path-line rule once, globally** (one line, middle-truncated) — the same secondary-line
   question appears in tiles, session rows and settings sub-lines, and per-surface answers are how the
   six-size type screen happened in the first place.
