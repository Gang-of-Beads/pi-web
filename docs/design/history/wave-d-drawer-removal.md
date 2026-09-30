# Wave D scope — drawer page removal (task-8) and its entanglements

The goal's task-8 rules: the ACTIVITY and NOTIFICATIONS drawer pages leave the
shell, unconverted; plugins that want pages build them through the existing
seams (`drawerSections` for drawer tabs, workspace panels for full pages). The
voice half of the task is already satisfied - core holds no voice wiring beyond
two stale comments, and the voice plugin owns every dictation, capture and
speech file.

Removing the two pages is a surgery on the most invariant-heavy component in
the client (ChatView, ~3.6k lines, twenty test files). This note records what
the pages are woven into, so the removal can be corrected on paper before it is
cut.

## What goes

- The two reserved drawer tabs and their panels: the activity panel (subagent
  rows, background task rows, run rows, filters, show-finished, the expandable
  per-run output view and the child-run conversation view) and the notifications
  panel (the per-session notification inbox, dismiss-one/dismiss-all, the empty
  and failed states).
- The reserved `"activity"` / `"notifications"` members of `DrawerTab`; the tab
  type collapses to contributed section ids only. With no contributed section
  the drawer renders nothing at all - honest absence, per the standing rule.
- The state and controllers that only fed the two pages: `activity`,
  `activityFailed`, `activityOutput`, `activityConversation`,
  `notificationInbox` in app state, and the polling/notification controllers in
 sofar as nothing else consumes them (knip is the referee).

## Entanglement 1 — the activity dock's tap target

The native dock (staying) labels live background work by reading the same
activity state the drawer panel used, and its tap calls `revealActivity()` -
which opens the drawer on the activity tab. With the page gone the label can
stay but the tap has nowhere to land: either the dock's background state
becomes a non-interactive pill, or the tap opens whatever contributed section
exists. Decision wanted: **silent pill** (default in the plan) vs retarget.

## Entanglement 2 — warnings lose their spec'd surface

`openspec/specs/chat/warning-delivery` shipped warnings INTO the notifications
drawer ("warnings belong in notifications"). Removing the notifications page
removes that surface. The delivery pipeline (server-side warning filing) is
untouched; the question is purely where a warning becomes visible: the error
notice bar already shows failures, but persisted warnings would only be
reachable through a future plugin page. Decision wanted: accept the gap until a
plugin builds a page (the goal's "不转换" reading), or keep a minimal warnings
strip somewhere native.

## Entanglement 3 — the subagent conversation view

Opening a child run's conversation from an activity row is a page-level feature
(`activityOutput` / `activityConversation`). It dies with the panel. The dock's
chevron and the subagent chips remain as the native skeleton; a plugin page
would be the future home.

## Plan once ruled

1. ChatView: delete the two tabs, panels, helpers and imports; the drawer and
   its collapse/keyboard machinery stay for contributed sections only.
2. drawerTabSelection: collapse the type; the selected tab falls back to the
   first section with content, else the first section, else undefined.
3. appState and PiWebApp: drop the orphaned fields and controller wiring.
4. Tests: the two pages' tests retire with them; dock, drawer-sections and
   warning-delivery tests update to the new shape.
5. Changeset (user-visible removal) + 8505 probe at 393x850 covering: drawer
   absent with no contributed sections, drawer present with goals, dock
   behaviour on live background work.

## Ruling and execution record

The owner ruled "不转换": the notifications and activity drawer pages leave the
shell without becoming plugin sections. The three defaults were executed as
written:

1. Dock background state is a silent pill: no tap, no reveal.
2. Warnings lose their drawer surface; the gap is accepted until a plugin page
   returns for them (server-side filing untouched). The surface carried more
   than warnings: the daemon also files dialog outcomes, command receipts and
   runtime notices as session notifications, and those lose their read-back
   surface too. The shipped openspec chat specs (settled-outcomes,
   warning-delivery, panel-load-honesty, pending-input-stability,
   state-consistency) still describe the drawer as that surface; a plugin page
   or a spec delta has to reconcile them.
3. The drawer renders nothing (no frame, no toggle) when no plugin contributes
   a section; `drawerTabSelection` is contributed-sections-only.

Beyond the plan's step 3, the whole notifications data layer went with the
pages: `sessionNotifications`, `sessionNotificationController`, the
`SessionNotificationSessionBridge` (socket `notifications.inbox` frames are now
ignored by the shell), the activity output/conversation views and their
session-controller methods, and the `activityFailed` flag (a failed subagent
read now keeps the previously read rows instead of a panel claiming failure).
The subagent count signal that fed the dock still polls, so the dock pill keeps
working on live background work.
