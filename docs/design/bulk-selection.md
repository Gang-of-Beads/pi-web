# Long press selects: one bulk mode for every list

Owner, 2026-09-30: "Long-pressing an item on any list page opens a bulk-operation page. Design it."

## What exists today

- The old session list (`SessionList.ts`, no longer rendered since `e6a11709`) had a Select key per group, "Select visible", and Archive and Delete for the selected rows. Nothing replaced it.
- A long press already means something. In the plugin lists (projects, workspaces, machines) and the quick switcher, a hold opens the row menu (`rowMenuGestures.ts`, `longPress.ts`). The Sessions page has no hold at all.
- The daemon already has batch routes: `archiveMany` and `deleteArchivedMany` each answer one request with the ids that succeeded and the ones that failed.

## Design

### Gesture

- **Long press** (500 ms, the finger moving under 10 px) on any row enters selection for that list, with that row selected. On Android a short vibration confirms it.
- **Desktop:** Shift-click or Ctrl/Cmd-click does the same, and a quiet "Select" key sits in the list header, so a mouse user can find the mode without knowing the gesture.
- **The row menu keeps its own entries.** The ⋯ key and a right-click still open it. A hold no longer does. That is a change for the plugin lists and the quick switcher, where a hold opens the menu today.

### One state machine

`selectionTransition(state, event)` is a pure classifier, with every state enumerated in tests:

| State | Leaves on | To |
|---|---|---|
| `browsing` | hold / modifier-click on a row | `selecting({row})` |
| `selecting(ids)` | tap a row | the same state with that row toggled |
|  | Select all | every visible row of that group |
|  | ✕, Escape, back, leaving the page | `browsing` |
|  | choose an action | `confirming` if destructive, else `acting` |
| `confirming(action, ids)` | Confirm / Cancel | `acting` / `selecting(ids)` |
| `acting(action, ids)` | the batch answers | `browsing`, with one result line |

- A selection is kept by id across list refreshes. A row that disappears (deleted on another device, say) drops out, and the count shows it.
- A selection stays inside **one group**: live sessions, archived sessions, projects. Actions differ between groups, so a hold in Archived selects among archived rows only.

### What the page looks like while selecting

- The list header becomes a selection bar, the same height as the search field and sticky: `✕ · 3 selected · Select all · [actions]`.
- Rows show a leading check mark, and a tap toggles instead of opening. The ⋯ keys hide.
- Every target meets the coarse-pointer floor (44 px).

### Actions

- One table per row kind, beside `navigateRowActions`, marks which actions work on many rows. The bar offers each action that fits **at least one** selected row and applies it to those rows only, so a mixed selection offers both Pin (2) and Unpin (1) (owner, 2026-10-09, ask 9d95632d: verbs, with the count when an action fits fewer than all).
- Destructive actions confirm with the count ("Delete 5 archived sessions permanently?").
- Each action runs as one batch request. The result line names any failures, and the list is re-read afterwards (the sync rule: never trust a local edit to match).

| List | Bulk actions |
|---|---|
| Sessions | Archive, Pin, Unpin, Mark as read |
| Archived sessions | Restore, Delete permanently |
| Projects | Pin, Unpin, Close project |
| Machines | none: a hold does nothing there |
| Plugin lists (Background, Subagents, Files…) | whatever the plugin declares through the list component |

### Where it lives

- Core: `selectionModel.ts` (the state machine), the bulk flags in the row-action tables, and one `<selection-bar>` element.
- The Sessions page adopts it first.
- Plugins cannot import host code, so plugin lists get the mode through the host list component (`docs/design/plugin-list-component.md`). A plugin declares its bulk actions in its list model, and the host draws the selection. That makes the list component the carrier for "any list page".

## Owner decisions (2026-09-30)

1. **Phone:** a long press turns the page into multi-select, with the bulk actions at the top. An action returns to the original list. There must be an exit key, so an accidental long press can always go back: `✕ Done` in the bar, the back gesture, and Escape.
2. **Desktop** does it in its own way: Shift/Ctrl-click, plus a quiet "Select" key in the list header. The menu stays on ⋯ and right-click.
3. **Scope:** "review every list, do everything that can be done, and ask when something is unclear". The review is below.
4. **The actions table is approved.**

## Review of every list (2026-09-30)

| List | Owner | Row actions today | Bulk actions |
|---|---|---|---|
| Sessions page › sessions | core | Open, Pin/Unpin, Rename, Archive | Archive, Pin, Unpin, Mark as read |
| Sessions page › Archived | core | Open, Restore, Delete permanently | Restore, Delete permanently |
| Sessions page › Projects | core | Open, Pin/Unpin, Copy path, Close project | Pin, Unpin, Close project |
| Sessions page › Machines | core | Switch to this machine | none: a hold does nothing |
| Quick switcher | core | Open, Rename | Archive, Pin, Unpin (the same sessions) |
| Context sheet › Projects | workspaces plugin | Close | Close project |
| Context sheet › Folders | workspaces plugin | actions other plugins contribute to a folder (git's worktree actions) | a contributed action that marks itself bulk; none do today |
| Context sheet › Machines | machines plugin | Check again, Open PI WEB, Rename…, Remove | Check again, Remove |
| Files, Background, Subagents, Goals, Relays, Updates, Git, Terminal | plugins | none per row | none: a hold does nothing |

A hold on a list without bulk actions does nothing, rather than entering a mode with nothing to do.

## Proof

- The state machine: one test per state and event.
- Live on 8505 at 393×850 with touch:
  1. A hold selects.
  2. A tap toggles.
  3. Select all.
  4. Archive three sessions; the daemon's listing agrees and the rows move to Archived.
  5. Restore two.
  6. Delete one permanently; confirm and cancel both work.
  7. ✕ exits.
  8. A hold on a plugin row selects (once the list component exists).
- The old build must fail each leg.
