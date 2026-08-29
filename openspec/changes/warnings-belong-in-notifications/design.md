## Context

Warnings are live diagnostics, not persisted messages: `warningsForSession`
(piSessionService.ts:4523) recomputes them on **every** status publish from the
runtime's resource loader, extension load errors, runtime setup diagnostics, and
the Anthropic subscription-auth notice. A `SessionWarning` has no stable id -
only `severity`, `message`, and optional `source`, `path`, `dismiss: {id}`.
`dismiss` exists only where `pi` itself has a durable off-switch (today:
`anthropicExtraUsage`), and `dismissWarning` (route `sessionRoutes.ts:458`,
service `piSessionService.ts:3192`) maps it back to the runtime's
`setWarnings`.

The drawer is a server-owned, generation-bound store
(`sessionNotificationStore.addNotification(generation, message, severity)`):
records are append-only, capped by `SESSION_NOTIFICATION_LIMIT` with oldest-first
eviction, fan out as `added`/`cleared` deltas, and drive the unread indicator on
every bound browser. Severity vocabularies already match one-to-one
(`info | warning | error`; `normalizeSeverity` passes them through).

On the client, `renderWarnings` (ChatView.ts:1695) draws each warning as a card
above the transcript via `chatSessionWarningRows` (ChatView.ts:685), with a
collapse bookkeeping module (`sessionWarningVisibility.ts`) existing only to
make the stack of cards bearable. The card's dismiss control calls
`sessions.dismissWarning`.

See proposal.md for why the cards must go.

## Goals / Non-Goals

**Goals:**

- One reliable filing point per warning occurrence, duplicate-free under the
  per-publish recomputation that defines warnings today.
- The durable off-switch (`dismiss`) survives the move, reachable from the
  notification record.
- The transcript top stops moving when warnings arrive or clear.
- Delete, rather than disable, the card machinery and its collapse state.

**Non-Goals:**

- Changing which conditions raise warnings, their text, or their severity.
- Persisting the filing memo across daemon restarts.
- Reconciling the drawer against live state (retracting records whose warning
  cleared) - the drawer is a record, not a mirror.
- Any redesign of the drawer itself.

## Decisions

**D1 - File server-side at the compute site, one producer.**
Every warning passes through `warningsForSession` on its way to `statusFromSession`;
that is the single filing point. Client-side filing was rejected: the drawer is a
server projection shared by all bound browsers, so browser-side filing would
double-file with two browsers open and file nothing while none is open. There is
no other producer to enumerate: both warning sources (runtime diagnostics and the
Anthropic notice) are merged inside `warningsForSession`, and no other module
reads `status.warnings` for delivery (the client rows helper only renders).

**D2 - Identity is the warning's content; a per-session memo dedupes.**
`identity = severity | source | path | message` (pre-truncation text), held in a
per-session in-memory `Set` alongside `notificationGenerationBySession`
(same lifecycle: WeakMap keyed by session, dropped on dispose). A publish files
only identities not in the memo. No persistence: after a daemon restart a
still-present warning files once more, which is honest - the condition was
re-observed in a new process. The memo is capped (128 identities, FIFO) against a
pathological diagnostics flood; eviction can in principle re-file, which is the
correct failure direction (a duplicate record, not a lost one). A warning that
clears and later recurs files again by design - the memo only prevents
*consecutive* republishes of the *same* occurrence.

**D3 - Filing happens during status assembly, before the status event leaves.**
The filer runs inside `statusFromSession`'s warning step and fans its mutations
out through the existing `publishNotificationMutations`, so the drawer delta and
the status that no longer carries cards arrive together. `statusFromSession` is
also called outside publishes (e.g. by `dismissWarning`'s response path); the
memo makes that harmless. When no notification generation is bound yet (session
opening), filing is skipped **without** memoizing, so the next bound publish
files it - skipping must never mark a warning as delivered.

**D4 - Carry the off-switch on the notification record.**
`SessionNotification` gains an optional `warningDismiss?: { id: string }`
(additive, opaque passthrough - the client never interprets it, mirroring the
warning card's contract). The drawer's existing dismissal control, for a record
carrying it, calls the existing `warnings/dismiss` endpoint *and* clears the row
through the existing local dismissal. Rejecting this field would silently drop
the one warning that has a web-reachable off-switch (the Anthropic billing
notice), which would re-file on every restart with no way to stop it. `source`
and `path` get no new fields: extension errors already embed the path in their
message text, and the card's source chip was cosmetic.

**D5 - A warning that clears itself leaves its record.**
No retraction, no reconciliation. The drawer is append-only with bounded
retention; a record of an occurrence is true forever, while a live mirror would
have to retract and would betray the delta model. The spec's recurrence scenario
covers the one behaviour this could be confused with.

**D6 - Delete the card machinery outright.**
`renderWarnings`, the `.session-warnings` styles, `chatSessionWarningRows` +
`ChatSessionWarningRow`, the `warningsVisible` / `onToggleWarnings` /
`onDismissWarning` props on `chat-view`, PiWebApp's `handleToggleWarnings` /
`handleDismissWarning` / `sessionWarningVisibility` state, and
`sessionWarningVisibility.ts` with its tests. The API client `dismissWarning`
and its route **stay** - the drawer's off-switch path uses them. Dead code is
not left behind (AGENTS.md).

## Risks / Trade-offs

- [Filing on the status hot path] → memo lookup is O(1) with no I/O; filing
  only mutates when a new identity appears, which is the same condition under
  which the old code re-rendered cards.
- [Identity collision via truncation] → identity is computed from the
  pre-truncation message; the `truncated` flag only describes the record text.
- [Memo cap eviction re-files under a flood] → bounded at 128; re-filing is a
  duplicate record, never a lost warning.
- [Record outlives its condition] → intended (D5); the `receivedAt` timestamp
  distinguishes an old occurrence from a live one.
- [Two dismissal semantics on one row] → the off-switch row's control does both
  (source + record) in one action, so the reader never faces a half-dismissed
  warning that keeps returning.
- [The five skill-collision warnings the owner saw] → they file once each and
  never again for that daemon process; the duplicate OpenSpec skill install that
  produced them is already removed (5da6fc6a).

## Migration Plan

Additive server field first, then filing, then client cleanup - each
independently committable (see tasks.md). No data migration: the memo is
in-memory, and existing notifications simply lack `warningDismiss`. Rollback is
`git revert` per task; the drawer tolerates records without the new field.

## Open Questions

None. The one candidate - whether the drawer row should re-display the card's
`source` chip - is cosmetic, does not change the specs, approach, or task
breakdown, and is deferrable.
