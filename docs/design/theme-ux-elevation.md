# Theme & UX elevation — research digest, live audit, and proposals

The owner's report: the base theme feels bare ("基础theme感觉很简陋"), and the UI/UX
work should be organized around user journeys. This document records what the
skills research actually contributes, audits the live 8505 surfaces with
screenshots, inventories the user journeys with their frictions, and proposes
three scopes of work at different risk levels. Product semantics belong to the
owner; this document ends at the ruling questions.

## 1. What the skills research contributes

Three sources, three different kinds of value.

**Anthropic's official `frontend-design` skill** (anthropics/claude-code
`plugins/frontend-design/skills/frontend-design/SKILL.md`). Its value is not
palettes — it is a *method* and a *tell list*:

- Work in two passes: a compact token plan (color 4–6 named values, type roles,
  layout concept, principles) → critique it against the brief ("would I produce
  this for any similar page?") → only then build.
- Spend boldness in one place: one memorable element, everything around it
  quiet and disciplined.
- The generated-page tell list reads as a description of our current surface:
  content chopped into identical rounded cards, one border-radius on everything
  regardless of hierarchy, the same soft shadow under each, ALL-CAPS labels,
  meta strings joined with middle dots, tinted near-black standing in for
  black.
- Copy rules: plain verbs, active voice, an action keeps its name through the
  flow, errors explain what happened and how to fix it, an empty screen is an
  invitation to act.

**ui-ux-pro-max** (local skill, already used for the shell row wave). Its
databases (79 styles, 192 palettes, 74 font pairings, 119 UX guidelines) plus
the rules already applied — touch spacing, no horizontal scroll, label overflow
needs an actionable disclosure, breakpoint testing. It stays the searchable
guideline layer.

**DESIGN.md** (Google Labs open standard for machine-readable design tokens).
Noted, not adopted: our tokens already live in one place with a theme-plugin
contract; a second metadata format would be ceremony.

**Borrowed method for this repo:** every visual change passes the two-pass plan
with the tell list as the critique rubric; every copy change passes the
plain-verb rules; the boldness budget is one memorable element per surface, not
per component.

## 2. Live evidence (8505 stack, seeded session)

Screenshots from the audit run (2026-09-06, `refactor/plugin-architecture` at
`4596cacd`): `/tmp/ux-audit-desktop-boot.png`, `/tmp/ux-audit-desktop-chat.png`,
`/tmp/ux-audit-mobile-chat.png`, `/tmp/shell-row-panel-phone.png`.

**Boot, desktop 1440×900.** The whole canvas answers with one muted line —
"Select a project and workspace to start a session." (`PiWebApp.ts:2507`) —
while the left rail shows the real blockers: the machine chip renders as
"Choo…", the workspace chip as "Choose wo…" (truncated primary controls), and
twelve identical project cards with truncated paths. The most important screen
for a new deployment is the least designed one.

**Chat, desktop.** Every message is a rounded card at the same radius with a
similar dark-blue surface; USER and ASSISTANT headers are ALL-CAPS micro-labels;
the pending ask renders as a form (stacked full-width outline buttons "Update
all / Update pi only / Update extensions only / Skip" plus a separate Cancel);
the status strip shows raw `↑100 ↓2.2k 10.8%/1.0M $5.99`. Craft details exist
(touch floors, focus rings, honest empty states) but nothing says who this
product is.

**Chat, mobile 393×850.** The ask card consumes ~60% of the viewport; the
question text appears twice (card title and body repeat the same update
sentence); the "ACTIVITY | NOTIFICATIONS (0)" strip spends a full row of prime
space above the transcript to show a zero count; an assistant card is cut
mid-row under the strip with no reading-position affordance visible.

## 3. Theme system audit — what exists, what is missing

**Exists, and is genuinely good** (`src/client/index.html:40-141`):

- Type scale `--pi-text-xs…xl` (12/13/14/15/17/20px) with leading and weights.
- Radius ladder `--pi-radius-xs…xl` + pill.
- Layer stack (`--pi-layer-raised…blocking`), control heights (32/44),
  motion tokens (`--pi-motion-fast/base/slow` + one ease), focus ring
  width/offset, chat measure/gutter, panel header heights.
- Font stacks by role (UI/display/mono), no webfonts, offline-safe by design.
- `interactiveSurfaceStyles` (`shared.ts:20-39`) kills tap-highlight on every
  control, asserted by a test.

**The gap — the theme layer is color-only.** `THEME_TOKENS`
(`src/client/src/theme.ts:28-64`) is 35 color/shadow variables. The theme pack
(`Gang-of-Beads/pi-web-themes`, 8 themes: pi-web-dark/light, classic,
high-contrast, night, paper, clay pair) contributes exactly those colors and
nothing else. Consequences:

1. Switching themes recolors a fixed design; the *design* itself — surface
   hierarchy, elevation, emphasis — is hardcoded in component CSS.
2. There is no semantic surface ladder: components pick literal tokens
   (`--pi-surface`, `--pi-border`) directly, so "card on panel on canvas" is
   expressed by ad-hoc token choices that every theme must anticipate.
3. There is no elevation scale: shadows are three raw rgba values
   (`--pi-shadow-soft/shadow/strong`) applied without a system; cards and
   panels differ only by a 1px border.
4. There is no state vocabulary: hover/active/disabled/selected surfaces are
   per-component decisions (`--pi-surface-hover` being the only shared one).
5. The identity layer is absent by design — the fallback palette is
   classic GitHub-dark (`index.html:108-141`), which is precisely the
   "safe, templated default" the frontend-design skill warns about. Nothing
   about the visual voice says *terminal-native power tool*.

## 4. User journey inventory

Journeys as the surface actually behaves on 8505; frictions carry severity
(high/medium/low) and a scope tag (A token-only, B identity/craft,
C journey fix needing a product ruling).

**J1 · First boot → first session.** Empty canvas with one muted line (high, C);
machine/workspace chips truncated to "Choo…/Choose wo…" (high, C — the control
is unreadable, Compact Label Overflow says truncation needs an actionable
disclosure); twelve identical project cards with truncated paths and an
unexplained blue presence dot (medium, B).

**J2 · Return → resume.** Boot restore and route restoration work (retries,
stale-silent-runs repair). The panel remembers nothing about *why* you left;
unread rings and badges carry the "what changed" story. No friction found
beyond J3's.

**J3 · Panel navigation → project → workspace → session.** Verified live
(probe-shell-row): rows meet floors, search works, unread counts render. The
SESSIONS header row crams four control styles (checkbox, link, primary button)
into one line (medium, B); section headers are ALL-CAPS micro-labels (low, B).

**J4 · Read a transcript.** Uniform card kit — same radius, similar surfaces,
ALL-CAPS role labels (high, B — this is the tell list verbatim); the
"EVENTS 1 event · 1 tool" strip sits between the tab strip and the transcript,
so three chrome rows stack before any content (medium, B/C); user/assistant
distinction is tint-only (cfb74933 improved it; structure could carry more).

**J5 · Answer an ask.** The card is a form, not a conversation moment: the
question title and body repeat the same sentence (high, C — ask
`AskUserCard.ts:89-110` renders question text in both places for single-step
asks); four stacked full-width outline buttons + separate Cancel read heavy on
mobile where the card takes ~60% of the viewport (high, B/C).

**J6 · Send a prompt & wait.** Composer is solid (collapse, dictation,
attachments, steering). The status strip is cryptic raw numbers `↑100 ↓2.2k
10.8%/1.0M $5.99` (`StatusBar.ts:25-30` builds honest data; the *labels* are
abbreviations only) (medium, B).

**J7 · Switch contexts.** Quick switcher (mod+p), machine tabs, project search
all verified working. The desktop-only pointer path to the switcher is a
leftover asymmetry (low, C — the shell row already routes mobile through the
panel).

**J8 · Appearance & themes.** Theme cards and follow-system work. The
appearance panel's contract is theme contributions; enriching token semantics
(section 3) needs the pi-web-themes pack to ship new tokens (medium, C ruling).

**J9 · Mobile system integration.** Safe areas, keyboard insets, 44px floors,
popstate back contract — all verified. No friction found in this audit.

## 5. Proposals — three scopes

**A · Surface & state token elevation** (core CSS/tokens only; no product
semantics; theme-compatible). Add the missing layers to `index.html` and
refactor component CSS onto them:

- Semantic surface ladder: `--pi-surface-canvas/panel/card/raised/overlay`
  with an elevation scale (`--pi-elevation-0…3`: none/border/shadow-soft/
  shadow-strong) so hierarchy stops being per-component improvisation.
- State vocabulary: `--pi-surface-hover/active/selected/disabled` + focus
  ring composition tokens, replacing per-component color math.
- Apply the existing motion tokens everywhere transitions exist (audit finds
  ad-hoc `120ms/150ms/180ms` literals in component CSS).
- The pi-web-themes pack maps old→new tokens (new tokens have fallbacks, so
  existing themes keep working unchanged).

Risk: low. Pure refactor, contract tests pin behavior, screenshots diff.

**B · Identity & craft pass** (visual semantics; needs a direction ruling).
Following the frontend-design method — one token plan, critiqued against the
tell list, boldness spent in one place:

- Candidate direction (to be ruled): **terminal-native identity** — the
  transcript is the product; mono becomes the voice of data (timestamps,
  counts, status strip, paths), role labels lose ALL-CAPS in favor of
  structure (indent/rule/marker), one accent carries all emphasis, surfaces
  step clearly (canvas < panel < card < raised) so the ask and dialogs read as
  *moments*, not forms.
- Message hierarchy: user/assistant/system distinguished by structure, not
  just tint; card radius follows hierarchy (one radius per level, not one for
  everything).
- Empty states become invitations (J1): the boot screen shows the one action
  that unblocks (Add project), styled as the surface's single memorable
  element.
- Ask card becomes a conversation moment (J5): question asked once, choices as
  a compact list, Cancel de-emphasized.
- Copy pass per the skill's writing rules across empty states, errors,
  buttons (an action keeps its name through its flow).

Risk: medium — touches ChatView/AskUserCard/empty states; chat-side work
should ride **with** the pi-web-activity wave (which already rewrites
ChatView's dock strip) to avoid double-touching the same file in two waves.

**C · Journey hardening** (product fixes; each needs a ruling):

1. J1 empty state as guided first action (which action: Add project vs
   Choose machine first?).
2. J1 chip truncation: machine/workspace chips get a minimum readable width
   and an overflow disclosure (menu), never mid-word ellipsis.
3. J5 ask-card duplicate question text: render the question once.
4. J4 chrome economy: merge or collapse the tab strip + events strip on
   mobile (activity plugin wave owns the mechanics; the *ruling* is whether
   the strips may merge).
5. J6 status strip: keep the numbers, add units/labels (tokens, context, cost
   already exist in `StatusBar.ts`; this is presentation only).
6. J7 desktop panel already hosts the switcher path; close the asymmetry or
   accept it.

## 6. Sequencing

- **A** can start immediately: it does not touch plugin seams and its
  screenshots contract is already scripted (`probe-shell-row.mjs`).
- **B**'s chat-side pieces fold into the pi-web-activity wave (step ② of the
  migration order); B's non-chat pieces (panel, empty states, ask card) can
  run as their own small wave after ① 投影缝.
- **C** items 1/3/5/6 are small and independent; item 4 belongs to the
  activity wave's ruling.

## 7. Ruling questions

Ruled by the owner (ask 92822913, 2026-09-06):

1. **Scope: A+B+C, all three.**
2. **Identity direction: terminal-native** as drafted in proposal B.
3. **Journey items: all six approved**, with the standing constraint: work
   only on `refactor/plugin-architecture`, and every touched flow gets
   end-to-end verification on the 8505 stack.
4. **Theme pack: same-wave update** — pi-web-themes gains the semantic tokens
   in the same wave as core.

## 8. Implementation order (from the rulings)

1. Wave UX-A: semantic surface ladder + state vocabulary + elevation scale in
   core (`index.html`, `THEME_TOKENS`), component CSS re-based on them; the
   pi-web-themes pack maps every theme onto the new ladder in the same wave.
2. Wave UX-B: terminal-native identity pass — token plan first (frontend-design
   two-pass method), then message hierarchy, ask card as conversation moment,
   empty states as invitations, mono as the data voice, copy rules.
3. Wave UX-C: the six journey fixes (empty-state guidance, chip truncation
   disclosure, ask duplicate text, strip economy, status labels, switcher
   parity) — small product fixes, each e2e-verified.
4. Every wave: bllm multi-lane review, 8505 live Playwright at 393×850 where
   phone-relevant, changesets, commit green pieces, push.
