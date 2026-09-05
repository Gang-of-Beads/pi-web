# Terminal-native identity — the Wave UX-B plan

The owner ruled the direction (ask 92822913): terminal-native, with the
frontend-design skill's method — a compact token plan, critiqued against the
generic-tell list before any code. This document is that plan; implementation
follows after Wave UX-A verifies on the 8505 stack.

## The brief

PI WEB is a cockpit for a coding agent running on your own machine. The
transcript is the product; everything else is scaffolding around it. The
audience is the owner: a developer who reads logs for a living, on desktop and
on a phone. The visual identity must come from that world — the terminal and
the chat log — not from a marketing page.

## Pass 1 — the plan

**The one memorable thing.** The transcript reads like a terminal log: data
speaks mono, prose speaks the UI stack. Every timestamp, count, path, model
name, token figure, and role word sets in `--pi-font-mono`; body prose never
does. Nothing else is exotic — the boldness budget is spent here and nowhere
else.

**Color.** No new palette in core. The theme packs remain the color layer
(pi-web-themes, eight themes, same-wave ladder mapping). Identity is carried by
structure: the surface ladder from Wave UX-A, one accent, state colors only for
state.

**Type roles.**

- Prose: `--pi-font-ui` at `--pi-text-base`, regular weight.
- The data voice: `--pi-font-mono` at `--pi-text-2xs`/`sm` for role words,
  timestamps, counts, the status strip, paths, and the data half of chips.
- Headers and labels: sentence case everywhere. The ALL-CAPS treatment
  (`.label` at `ChatView.ts:533`, `.drawer-tab` at `:173`, `.subagent-kind` at
  `:225`) is removed — not resized, not re-colored: removed.

**Structure over labels.** Role is a log convention, not a badge: the message
header renders the role word in plain lowercase mono (`user`, `assistant`,
`system`), the way an IRC or CI log does. No caps, no letter-spacing, no
marker glyphs. The sticky header and the queued/user accent colors keep their
jobs.

**Radius discipline.** Message and dialog cards keep `--pi-radius-lg`; inline
data chips step down to `--pi-radius-sm`; `--pi-radius-pill` remains only for
true pills (the activity dock). One radius per level of hierarchy.

**Motion.** No new motion. The existing motion tokens only; the Wave UX-A
elevation scale replaces ad-hoc shadows.

**Copy.** Plain verbs, active voice, an action keeps its name through its
flow; an empty screen is an invitation to act; errors say what happened and
how to fix it.

## Pass 2 — critique against the tell list

- *Identical rounded cards, one radius on everything* → the surface ladder and
  the radius discipline above; message cards share a radius but sit on distinct
  ladder stops with structural role markers.
- *ALL-CAPS labels* → all three caps sites are removed, replaced by mono
  sentence case. This is the biggest single de-templating move available.
- *Meta strings joined with middle dots* → adjudicated per site at
  implementation: the queue chip ("Queued · 3", `ChatView.ts:645`), the
  collapsed-meta tooltip (`:703`), the activity tab ("Activity · 2 running",
  `:3449`) and the dock ("idle · 2 background runs", `:3521`) keep their dots —
  each joins a count to its unit, which reads as data, not decoration; the
  genuine duplication lived in the extension dialog's split title and is fixed
  there (below).
- *Monospace for small data labels is itself a generated-page tell* → here mono
  is the subject (the log convention), not decoration: it is applied to data
  the terminal actually emits, without letter-spacing or caps. The tell is the
  treatment; we keep only the voice.
- *Cream-and-terracotta / tinted near-black defaults* → not applicable; color
  stays with the theme packs.
- *Would a generic dashboard reach for this?* A generic dashboard reaches for
  caps eyebrows, uniform card grids, and decorative gradients. This plan
  removes the first two and uses none of the third; the `log-voice` header and
  the theme-pack color layer are specific to this subject.

## Implementation checklist (after UX-A verifies)

1. De-cap and mono the three label sites; role words render as lowercase log
   words (`ChatView.ts:533,173,225,2646`).
2. Status strip gains units and mono (`StatusBar.ts:25-30`): `↑ 100 tok`,
   `↓ 2.2k tok`, `ctx 10.8% / 1.0M`, `$5.99` — copy finalized against a live
   screenshot before commit (journey fix C5).
3. Ask card as a conversation moment: the question renders once (C3), choices
   compact, Cancel de-emphasized; it already sits on `--pi-surface-raised` with
   `--pi-elevation-3` from Wave UX-A.
4. Empty states invite (C1): `sessionEmptyMessage` (`PiWebApp.ts:2502`) gains
   the unblocking action — Add project on an empty roster, per the owner's
   ruling of "empty state guidance".
5. Copy pass across buttons and errors per the writing rules; an action keeps
   its name from trigger to receipt.

## Implementation record (updated as sites land)

1. De-cap and mono the three label sites — landed: `.label` renders role and
   group words as lowercase log text in mono; `.drawer-tab` drops caps and
   letter-spacing; `.subagent-kind` renders in mono (`ChatView.ts`).
2. Status strip gains units and mono (`StatusBar.ts`): `↑ 100 tok`,
   `↓ 2.2k tok`, `ctx 10.8% of 1.0M`, `$5.99` — landed.
3. Extension dialog title partitioned, not repeated (`splitDialogTitle`):
   an over-long line splits at a word boundary, heading and body together
   carry the text once — landed (this was the "ask duplicates its text"
   finding; the card is the extension dialog, not the ask card).
4. Empty states invite (C1): `sessionEmptyMessage` gains the unblocking
   action — Add a project on an empty roster, Start a session with a
   workspace selected — landed in `PiWebApp.ts`.
5. Copy pass across buttons and errors: the existing copy already follows
   the writing rules ("Send answers", "Sending…", errors say what happened);   no change needed — verified against the live surfaces.

## Non-goals

- No webfonts (offline PWA constraint stands).
- No new themes in core; the packs own color.
- No change to the shell row, panel structure, or navigation (settled by the
  shell wave and probe-pinned).
