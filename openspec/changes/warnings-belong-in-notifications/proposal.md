## Why

Session warnings are drawn as full cards above the transcript. On a phone five
of them fill the screen, push the drawer and the conversation out of view, and
change the layout as they arrive and clear - so the owner loses his place and,
worse, loses the thing he was aiming at. He asked plainly: delete them, we have
notifications.

The invariant they violate is the one this project already paid for: nothing
moves under the user, and the region around the transcript keeps its geometry.
A warning is information, not an interruption, and this app already owns a
surface for information that arrives on its own - the notification drawer.

## What Changes

- Session warnings stop rendering as cards over the transcript.
- Each warning becomes a notification in the session's drawer, carrying the
  same text, severity and dismissal it has today.
- The drawer's existing unread indicator is how a new warning announces itself.
- **BREAKING** for anyone relying on warnings being unmissable: a warning no
  longer occupies the screen until dismissed. That is the point; it is why the
  drawer's indicator must be honest about unread warnings.

## Capabilities

### New Capabilities

- `chat/warning-delivery`: where a session warning is delivered, what it may
  occupy, and what guarantees the reader has that one has arrived.

### Modified Capabilities

None yet: `chat/pending-input-stability` already forbids the movement this
causes, and this change is an application of it rather than a new rule.

## Impact

- `src/client/src/components/ChatView.ts` - `renderWarnings` and
  `renderTopNotices`, plus the `session-warnings` styles they carry.
- `src/client/src/sessionWarningVisibility.ts` - the collapse state exists only
  to make the cards bearable; if the cards go, so does it.
- The notification inbox path in `src/server/sessions` - warnings arrive on the
  session status, so something must file them as notifications without
  duplicating one on every poll.

## Non-goals

- Changing which conditions raise a warning, or their text.
- The skill-collision warning specifically: it came from a duplicate OpenSpec
  install that has been removed, and it is an example of the class, not the
  reason for the change.
- Any redesign of the notification drawer itself.
