# The interactive card

Owner, 2026-10-12: "it does not have to be question / ask user; can it be one generic kind of interactive card, so every case that wants such a card can use it?" Chosen: one card kind, the extensions change with it, and core keeps no `questions` kind.

## What changes

Before 2026-10-12, an extension declared `ctx.ui.custom(factory, { web: { kind: "questions", questions } })`. Core drew a card of questions (options, single or multiple, an optional typed answer) and resolved `custom()` with the answers. The card, its types and its routes were named after one extension (`AskUserCard`, `AskUserQuestion`, `askUserSubmissionFromBody`).

After the change an extension declares a **card**: a title and a list of fields. Core draws the fields, collects what the reader enters, and resolves `custom()` with the values keyed by field id. Core knows field types, not extensions.

```ts
ctx.ui.custom(factory, {
  web: {
    kind: "card",
    title: "Which plan?",            // optional
    fields: [
      { type: "text", id: "why", text: "Both plans keep the API; B also moves the store." },
      { type: "choice", id: "plan", label: "Plan", options: [{ value: "a", label: "Plan A" }, { value: "b", label: "Plan B", detail: "Moves the store" }], multiple: false, other: "field" },
      { type: "input", id: "note", label: "Anything else?", multiline: true, placeholder: "Optional" },
    ],
    submit: "Send",                  // optional button words
  },
});
// resolves { values: { plan: { selected: ["b"] }, note: { text: "keep the tests" } } }, or undefined when closed unanswered
```

## Field types

| Type | Draws | Value in the result |
|---|---|---|
| `text` | Read-only prose (markdown), for context between fields | none |
| `choice` | At least one option; `multiple` for several; `other: "choice"` a Custom choice that opens a box, `other: "field"` a box under the options, absent no typed answer | `{ selected: string[], other?: string }` |
| `input` | One line, or a box with `multiline`; an optional `placeholder` | `{ text: string }` |
| `confirm` | Two choices, the confirm words and the decline words (`confirm: "Delete", decline: "Keep"`; "Yes" and "No" when absent) | `{ confirmed: boolean }` |

Every field but `text` has a `label` and an optional `detail`.

- **Required** (owner, 2026-10-12: "add required"): a field with `required: true` must be filled before the card moves past it; Next and Submit stay disabled until it is. A field without it may be left untouched, and is then absent from `values`.
- Leaving optional fields untouched asks once before sending, as today ("Send without answering: …?").
- A card of `text` fields only is an acknowledgement: Submit resolves `{ values: {} }`.
- Every id is unique within the card. Bounds stay as today (20 fields, 12 options, 1,000 characters of prose, 4,000 of typed text), named for the card.
- A declaration that does not fit is refused and the terminal screen is drawn instead, as today (P5); the daemon log says why.
- `ctx.ui.piWebScreens` lists `"card"`, so an extension can tell "closed unanswered" from "no such card here".

## Steps

The card shows one answerable field at a time, as the questions card did, so the field being typed into stays above a phone's keyboard. A `text` field is shown with the answerable field after it (or alone, on the last step, when nothing follows it). Back and Next move between steps; the last step's button is the card's `submit` words ("Send" when absent). The header is the card's `title`, or the extension's name when it declares none, and counts "2 of 4 · 1 answered". Cancel closes the card unanswered.

## Look (owner review on a phone, 2026-10-12)

- Each answerable field is numbered ("1.", green once answered), as the questions card was.
- Each option row has its own border (22% of the text colour, so it shows in the dark theme too); a picked row takes the accent border and the selection background.
- A typed box under the options starts at the options' left edge.
- Cancel, Back and Next/Send share the footer row equally.
- The words in the header and on the last button are the extension's: pi-ask-user declares "Questions" and "Send answers".

## What it replaces

| Today | After |
|---|---|
| `kind: "questions"`, `questions[]` | `kind: "card"`, `fields[]` of type `choice` |
| `question`, `detail` | `label`, a `text` field or the choice's `detail` |
| `custom: false` / `customInput: "field"` | `other` absent / `other: "field"`; the default Custom choice becomes `other: "choice"` |
| `AskUserSubmission { answers: [{ id, values, otherText }] }` | `{ values: { [id]: { selected, other } } }` |
| `AskUserCard`, `askDrafts`, `AskUser*` types, `askUserSubmissionFromBody` | `InteractiveCard`, `cardDrafts`, `Card*` types, `cardSubmissionFromBody` |

Core keeps no `questions` kind and no `AskUser` name. The two extensions that declared questions were forks maintained alongside PI WEB and changed in the same wave:

- Gang-of-Beads/pi-ask-user: its question tool declares a card of choice fields.
- Gang-of-Beads/pi-goal (the earlier project, now archived as Gang-of-Beads/pi-goal-archive): its questionnaire and confirmation declare a card (a confirmation becomes a `confirm` field).

An extension still declaring `questions` gets the terminal screen, like any declaration core does not know.

## Where it lives

- `src/shared/interactiveCard.ts`: the declaration, field and value types and their bounds.
- `src/server/daemon/sessions/declaredScreen.ts`: reads a `card` declaration and validates a submission against its fields (one reader per field type, keyed by type).
- `src/client/src/components/InteractiveCard.ts`: draws the fields (one renderer per type, a `Record` keyed by the type) and keeps the reader's draft per field.
- The dialog route, the drafts store and the transcript's answered row read the card's values, not answers.

## Status

Built 2026-10-12: the core types, the daemon's reading and validation, the card, its drafts and the answered row (a session daemon restart), and the two forks' card declarations with their own tests. Checked live on a phone layout (393x850): a single choice submits on tap; several fields with Submit; input, multiline, confirm; a refused declaration draws the terminal screen; closing unanswered resolves `undefined`.
