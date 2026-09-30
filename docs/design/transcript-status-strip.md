# Transcript status bar, and one gutter rule

Design for review. Two complaints from the owner on the live phone build:

1. A plugin-contributed status ("Git · main (stale)") sits in the dock above the composer,
   pulses, and is in the wrong place. He wants it in the ≡ menu, or in a new dropdown
   status bar at the top.
2. The transcript's own rows do not share a left edge on the phone: the "live events" row's
   text starts where a card's border starts, not where the message text starts. And the
   label says "live events" for a group that has already finished.

## Decisions (owner, 2026-09-28)

1. Both entry points, and the **plugin chooses**: a contribution declares `placement:
   "top" | "menu" | "both"`; the core renders whichever it asked for. The chip row in the
   dock above the composer is **removed**.
2. The pulse answers "is this thing running right now": it stays, but only on a chip whose
   plugin says it is running (`running(ctx)`), so a stale git chip stops blinking.
3. The "live events" label keeps its current rule.
4. Row margins are **templated, not per-row**: one table assigns each row *kind* to a
   margin group, and one CSS rule per group carries the values. A new row kind fails a test
   until it is classified, instead of inventing its own padding.

## 1. Where a plugin's status lives

Today the runs entry renders inside the scroller's dock, under the messages and above the
composer. That is where the *reader's* attention is when a turn ends, but a status that
says "something is running" belongs with the chrome, not with the transcript: it does not
scroll, it does not eat transcript height on a phone, and it cannot be mistaken for a
message.

**Proposal: a status strip at the top, pinned under the header.**

- One row, height on the control scale (36px), sticky under the header, transcript scrolls
  beneath it.
- Contains one chip per contributed surface that has something to say (`summary` or
  `badge` - the plugin's own words, core stays ignorant).
- A chip with nothing running is quiet: no dot, no pulse, muted text. A chip with a
  running thing shows one dot and pulses **that chip only**. This is the fix for "it keeps flashing":
  the artefact was a pulsing dot on a *stale* git chip, which is not a live thing.
- Tapping a chip opens that contributed surface's own body, as a dropdown under the strip,
  full width, capped height with its own scroll - the plugin renders its rows, the core
  only hosts.
- The strip hides itself entirely when nothing has anything to say, and the ≡ menu keeps a
  plain list of the same entries as a fallback (his second suggestion, cheap to add because
  both read the same contribution list).

Alternatives:
- *Everything into the ≡ menu*: cheapest, but the count then needs a badge on the ≡ button
  and the reader has to open a menu to see "is anything running".
- *Drawer section*: that is where these lived before the drawer went; a drawer is a surface
  of its own with its own scroll, which is heavier than a strip for one line.

## 2. One gutter rule

The rule the desktop already follows, restated so the phone stops disagreeing with it:

| Row kind | Own inset (phone / desktop) | Why |
|---|---|---|
| Card rows (`.msg`, ask card, tool card) | card padding (`--pi-row-gutter`) | the card draws the edge; its text insets by the card's own padding |
| Bare rows (`event-group` summary, session activity, group rows, waiting slot) | `--pi-row-inset`: **0 / 24px** today, **wants the card padding on the phone too** | a bare row has no card to inset its text, so it must add the same padding the card rows do, or its text sits at the card's border |

So the phone change is exactly one value: `--pi-row-inset` from `0` to `var(--pi-space-5)`
on the phone, so bare-row text lands where card-row text lands (18px in the current phone
shot). The cards themselves keep their current padding - that was his "margin too big"
complaint, and it was about cards.

The guard is the existing probe: it measures where each row kind's text starts, on both
widths, and fails on a spread above a card border.

## 3. The "live events" label

`chatMessageGroupLabel(defaultOpen)` says "live events" whenever the group is the newest
one - including after the turn it describes has finished. Proposal: the label is about the
*group*, not the scroll position: "events" for a finished group, "live events" only while
the session is streaming and this is the tail group. That needs the streaming fact at the
label, which the renderer has.

Open question for the owner: should a finished group keep its collapsed "N events" count
line at all, or fold into the turn's assistant row?

## 4. Order of work

1. Move the strip to the top; chip quietness; dropdown host. (No plugin changes.)
2. Phone inset value for bare rows + probe expectation.
3. Label honesty.

Then one release, after his review.
