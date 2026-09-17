# Review triage — the context path, message colour and bordered chrome

Wave under review: `6161ba50` (role colour), `15f1a438` (message info box),
`6209dc1d` (bordered close controls), `ab8b6cee` (context path), `cfb9a219`
(Updates fold summary, probe sees the path), plus the follow-up fixes recorded
here. Two anonymous lanes read the diff and the live files: lane A on
behaviour, state and scope; lane B on structure, accessibility and red-teaming.

## Fixed in the follow-up

| Finding | Where | What was wrong |
| --- | --- | --- |
| The path could claim a scope the list did not have | `src/client/src/switcherBreadcrumb.ts` | A stored project or folder key that no level offered still filtered the sessions while the path read "All projects" — an empty room with no control to widen. `reconcileBreadcrumbFilter` drops a key nothing offers, and the component filters through it. |
| Browsing another machine lost every level | `src/client/src/switcherBreadcrumb.ts` | The host passes no projects while browsing elsewhere, and the old chip row fell back to listing the workspaces. The project level is omitted when there are no projects, and the folder level then offers every folder, so a remote machine stays filterable. |
| The path control lost the coarse-pointer floor | `src/client/src/components/QuickSwitcher.ts` | `.crumb` draws at the 32px template height with no reach; it now grows to the 44px floor through a reach pseudo-element, as the message actions do, and both path controls take a focus ring. |
| The level announced expansion while owning nothing | `src/client/src/components/QuickSwitcher.ts` | The `role="listbox"` was emitted outside the `<nav>` with no `id`, and the crumb had no `aria-controls`. The list is inside the path with an id the crumb points at, and its label names the level in words instead of leaking the enum. |
| The border guard banned one spelling | `src/client/src/components/closeControlBorder.test.ts` | It only rejected `border: 0;`, so a control declaring no border at all passed. It now requires the base rule to draw a border, rejects `0`, `0px`, `none` and `border-width: 0` in any rule for the selector, asserts it inspected something, and has its own spelling tests. |
| The probe could pass vacuously | `scripts/probe-menu-key.mjs` | It assumed the first crumb was the project level (wrong on a multi-machine stack) and accepted a level whose only option was the widening row. It now finds the project level by name, requires `aria-controls` to resolve to a real list, requires at least one real project beside "All projects", and asserts the level closes again. |
| Dead chip and tab styles | `src/client/src/components/QuickSwitcher.ts` | `.filters`, `.chip*` and `.machine-tab*` outlived their markup. Removed with the stale comments that described them. |

## Judged not true

- `openLevel` surviving a close/reopen: the element is rendered conditionally, so its reactive state is destroyed with it.
- A stale filter surviving a machine switch: `willUpdate` clears the filter on any `browseMachineId` change.
- A folder filter leaking across a project change: choosing a project replaces the filter wholesale.
- Choosing a level navigating away or closing the menu: the handlers only mutate the filter and the open level.
- A folder level appearing for a project with no folders, and folder narrowing failing to filter: both covered by `switcherBreadcrumb.test.ts` and the `path`/`cwd` comparison.
- The Updates summary claiming a false zero: the summary is `undefined` at zero and renders nothing.
- Role colours becoming indistinguishable or falling under the contrast floor; the plain assistant header showing scrolled text through it (the surface token is opaque).

## Deferred, with reasons

- Focus does not enter the open level's list and does not return to the crumb; the options are `role="option"` buttons without roving focus. Reachable in DOM order today; the honest fix is either roving focus or dropping the listbox roles, which is a separate decision.
- Narrowing to a project whose workspaces are not loaded yet filters nothing, and the empty state says "No sessions yet." where it should name the narrowing and offer to widen. Pre-existing, but the persistent path makes it more visible.
- An unknown `browseMachineId` renders a crumb labelled "Machine" with no widening row.
- Folder options are keyed by path rather than id, so two folders sharing a path would both read as current.
- The border guard covers `src/client/src/components` only; plugin components are unchecked.
- `loadError` in the menu still has no retry control.
