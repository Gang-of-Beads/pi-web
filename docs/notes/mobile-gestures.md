# Mobile gestures: what the platform already owns

Constraint note for the mobile work (task-5 long-press menus, task-7 mobile
shell). The rule is simple: the app never binds a gesture the OS or browser has
already claimed, because the user cannot tell our gesture from the system's and
will trigger the wrong one.

## Reserved by the system — do not bind

| Gesture | Owned by | Consequence if we use it |
|---|---|---|
| Horizontal swipe from the left/right **screen edge** | iOS Safari back/forward; Android gesture-nav back | A swipe-to-action on a row that starts at the edge fires system back instead. Any row swipe must start inside the content, not in the ~20px edge gutter. |
| Long-press on **text** | iOS selection callout + magnifier; Android text context menu | A long-press menu on a row that contains selectable text races the OS callout. Interactive rows opt out of native callout/selection (see below). |
| Double-tap | Zoom | Already neutralised with `touch-action: manipulation` on controls; keep it. |
| Pull-down at the top of a scroll | Browser pull-to-refresh (Android Chrome) | A custom pull gesture at scroll-top double-fires. Leave the top edge alone, or set `overscroll-behavior: contain` on the scroller that must not trigger it. |
| Two-finger / pinch | Zoom | Never bind. |
| Swipe down from the top edge, up from the bottom edge | OS notification shade / app switcher | Never bind. |

## What the app may use

- **Long-press** to open a row's context menu, only on rows that first opt out of
  the native callout:
  ```css
  .action-row { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  ```
  The existing `longPress.ts` is the single source; it must cancel on scroll so a
  drag that becomes a scroll does not also open the menu.
- **Tap** anywhere non-edge.
- **Vertical scroll** inside a scroller.
- **Horizontal swipe that begins away from the screen edge** (row reveal
  actions), if we add them — with a dead zone matching the system edge gutter and
  a movement threshold so a diagonal scroll is not read as a swipe. This is
  optional; the context menu already covers every row action, so a row swipe is
  an accelerator, never the only way.

## Back and history

The app already integrates the system back gesture through `popstate` and a
pushed placeholder frame (`PiWebApp.ts`, `PiWebApp.backGesture.test.ts`): a modal
layer closes on back before the route is restored. The redesign keeps that
contract — every new overlay (context menu, filter sheet, fleet panel) registers
as a modal layer so system back closes it one level at a time instead of
navigating away from the app.

## Keyboard and focus on mobile

- Keyboard shortcuts are desktop-only; the mobile build must not depend on any
  chord (`⌘G`-style sequences) for a capability, which the feature map already
  requires by giving every such capability a visible entry point.
- The soft keyboard is handled with `--pi-app-keyboard-inset` (`keyboardInset.ts`)
  so the composer and any bottom-anchored sheet stay above it. Any new bottom
  sheet reuses that inset rather than assuming a fixed viewport height.

## Checklist for any new mobile interaction

1. Does it start in the screen-edge gutter? If yes, move it inboard.
2. Does it long-press on text without opting out of the callout? If yes, opt out.
3. Does it work at the top of a scroller where pull-to-refresh lives? If yes,
   contain the overscroll.
4. Does it register as a modal layer so system back closes it? If it is an
   overlay, it must.
5. Is every capability it exposes also reachable without the gesture (tap/menu)?
   The gesture is an accelerator, not the only door.
