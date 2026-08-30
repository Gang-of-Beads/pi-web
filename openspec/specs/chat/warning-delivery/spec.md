# warning-delivery Specification

## Purpose

Delivers a session warning to the reader through the notification drawer - the
surface this app already owns for information that arrives on its own - instead
of as a card over the transcript, and states what the reader is owed when a
warning arrives, repeats, clears, or carries a durable off-switch.

## Requirements

### Requirement: A warning is delivered where information is delivered

A session warning SHALL be filed as a notification in the session's drawer. A
warning SHALL NOT render as a card above the transcript, and its arrival or
clearing SHALL NOT move any part of the transcript or the controls around it.

#### Scenario: A warning arrives

- **WHEN** the session's status carries a warning that has not been delivered
  before
- **THEN** the drawer gains one row for it with its severity and message, the
  drawer's unread indicator reflects it, and nothing above the transcript
  appears, grows, or shifts

#### Scenario: A repeated status publish carries the same warning

- **WHEN** a later status publish again carries a warning already delivered to
  this session
- **THEN** no additional notification is filed for it

### Requirement: One occurrence, one record

Each distinct warning occurrence SHALL produce exactly one notification, and
that notification SHALL remain a readable record afterwards.

#### Scenario: The warning clears itself

- **WHEN** a warning stops being reported by the session's status
- **THEN** its notification SHALL remain in the drawer unchanged, because the
  drawer is a record of what arrived, not a mirror of live state

#### Scenario: The same condition recurs

- **WHEN** a warning that had cleared is reported again later
- **THEN** a new notification SHALL be filed for the new occurrence, and the
  earlier record SHALL remain

#### Scenario: A long warning is recorded

- **WHEN** a warning's message exceeds the notification message limit
- **THEN** the notification SHALL carry the truncated text and SHALL mark
  itself as truncated, so a shortened record never reads as a complete one

### Requirement: A durable off-switch stays reachable through the record

A warning that carries a durable off-switch in the underlying agent SHALL keep
that off-switch reachable from its notification, and using it SHALL suppress
the warning at its source and remove its record from the drawer.

#### Scenario: The reader dismisses a warning that has an off-switch

- **WHEN** the reader dismisses a notification whose warning carried an
  off-switch
- **THEN** the off-switch is applied at the source, the record leaves the
  drawer, and later status publishes SHALL NOT file the warning again

#### Scenario: A warning without an off-switch

- **WHEN** the reader dismisses a notification whose warning carried no
  off-switch
- **THEN** only the record leaves the drawer, and a recurrence of the condition
  SHALL still be filed, because nothing at the source was changed

### Requirement: Delivery is session-scoped

A warning notification SHALL be delivered only to the session that reported it,
and SHALL NOT appear in any other session's drawer.

#### Scenario: Two sessions on one machine

- **WHEN** one session's runtime reports a diagnostic and another session's
  does not
- **THEN** only the reporting session's drawer gains a record
