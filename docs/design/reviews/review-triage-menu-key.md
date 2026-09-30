# Review triage — the phone menu key (≡) and list pins

Change under review: `f2f91c20` "The phone menu key opens the menu, not the
projects page", plus the follow-up fixes recorded here. Two anonymous review
lanes read the diff and the live files: lane A on behaviour and state, lane B
on structure, accessibility and red-team probing.

## Fixed in the follow-up

| Finding | Where | What was wrong |
| --- | --- | --- |
| A pinned root was lifted away from its own descendants | `src/client/src/sessionListPins.ts` | Only `depth === 0` was checked, so a pinned root with expanded subagent rows left them stranded under whatever root followed. A root is now lifted only when the next row is also a root; the classifier's states are enumerated in `sessionListPins.test.ts` (pinned child, pinned root with children, unknown pin id, empty list, empty pin set, searching). |
| `aria-expanded="false"` was frozen in menu mode | `src/client/src/components/appShell/AppContextBar.ts` | The key never expands anything in menu mode, so a permanently collapsed state was a lie. The attribute is now omitted there and `aria-haspopup="dialog"` carries the meaning; panel mode keeps `aria-expanded` and omits `haspopup`. |
| An accessible name on a roleless `<span>` | `src/client/src/components/appShell/AppContextBar.ts` | The inert title carried `aria-label` including "Hold to rename", which a generic element cannot expose. The label is gone; the title reads as text and rename stays reachable from the session row menu, with the touch hold kept as a shortcut. |
| The probe's dismissal leg was vacuous | `scripts/probe-menu-key.mjs` | It called a non-existent `closeQuickSwitcher?.()`, so the central claim — dismissing returns to the same session and view — was never asserted. It now presses Escape and asserts the menu is gone with the view and session unchanged. |
| The probe's substring assertions could pass on regression | `scripts/probe-menu-key.mjs` | `textContent` matching would find "Settings" anywhere in the menu. It now reads `footer button` labels, requires an enabled new-session control, pins a session asserted to be a root, and asserts a row follows the Pinned heading. |
| No test covered the new bar states | `src/client/src/components/appShell/AppContextBar.menuKey.test.ts` | `panelToggleLabel` is enumerated, so a key that promises the wrong surface fails in CI. |

## Judged not true

- Desktop/tablet regression of the panel toggle: `isMobileNavigationLayout === false` keeps `toggleTarget="panel"`, the old labels, `aria-expanded` on `panelOpen`, and the quick-switch handler on the title.
- The menu key navigating away: `openQuickSwitcher` only sets a flag and pushes a modal frame; closing pops it without touching the view or the selection. Now also asserted by the probe rather than by reading alone.
- Pin/Unpin offered on archived rows: the entry is inside the non-archived branch of the row menu.
- Menu key and row-menu entries below the touch floor: 36px controls inside a 44px bar is the documented template, and row-menu buttons inherit the comfort height.
- A stray modal frame from opening Settings out of the menu: the placeholder frame is replaced, not stacked.

## Deferred, with reasons

- **Pins are stored unscoped** (`src/client/src/sessionPins.ts`): a flat id list with no machine key, never pruned. The lanes disagreed on severity; reading the data path settles it — the list is only ever handed the selected machine's sessions, and the switcher guards the browsing-elsewhere case, so there is no live leak today. The residue is unbounded growth and a recycled id arriving pinned. Key the set by machine when that file is next touched.
- Quick-switcher footer buttons stack flush with no gap, and Settings sits in an otherwise machine-scoped menu without a separator.
- The Pinned heading has no `role="group"`/`aria-labelledby` association with its rows.
- `splitPinnedSessionRows` is computed at two call sites in `SessionList.render`; it should be computed once and passed down.
