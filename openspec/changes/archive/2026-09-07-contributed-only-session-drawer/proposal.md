# Contributed-only session drawer

## Why

The Wave D ruling removed the built-in Activity and Notifications drawer pages
from the shell without converting them to plugin sections
(`docs/design/wave-d-drawer-removal.md`, commit e12be019). Five shipped chat
specs still describe that drawer as a built-in surface with notification rows,
dismissal, and read-back; a reader checking the implementation against the
specs finds promises no surface keeps. This change reconciles the specs with
the executed ruling so the recorded contract matches the product again.

## What Changes

- **BREAKING**: the session drawer is specified as contributed-sections-only:
  it renders exactly what plugins contribute, shows no tabs when nothing
  contributes, and no built-in Activity or Notifications tab exists.
- Warning delivery is respecified to file-only honesty: warnings, dialog
  outcomes, command receipts and runtime notices stay filed as session
  notifications server-side, with no built-in read-back or dismissal surface
  until a plugin page provides one.
- Panel-load-honesty's notification-panel scenarios are removed; honesty
  requirements move to the contributing plugin's own surface.
- Pending-input-stability and state-consistency requirements that keyed off
  the notification count or drawer rows are reworded to survive without a
  built-in drawer (live-transcript stability and cross-session state stay).
- No product code changes: the implementation already matches this contract
  (verified by the Wave D review lanes and the 10/10 live probe).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `chat/warning-delivery` — drawer as the delivery surface becomes filing-only
  until a plugin page exists.
- `chat/settled-outcomes` — the read-back surface for filed outcomes becomes
  conditional on a contributing plugin instead of a built-in drawer.
- `chat/panel-load-honesty` — the notification-panel honesty scenarios are
  removed with the panel.
- `chat/pending-input-stability` — scenarios referencing the notification
  count and cards are reworded to the transcript's own surfaces.
- `chat/state-consistency` — cross-session state examples stop leaning on the
  removed notification inbox as the canonical revision-check example.
