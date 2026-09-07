# warning-delivery DELTA

## MODIFIED Requirements

### Requirement: A warning is delivered where information is delivered

A session warning SHALL be filed as a session notification at its source. A
warning SHALL NOT render as a card above the transcript, and its arrival or
clearing SHALL NOT move any part of the transcript or the controls around it.
The shell ships no built-in read-back surface for filed notifications; reading
them SHALL require a plugin-contributed page, and until one is installed the
records stay filed and unread.

#### Scenario: A warning arrives

- **WHEN** the session's status carries a warning that has not been delivered
  before
- **THEN** the warning is filed as a session notification with its severity
  and message, and nothing above the transcript appears, grows, or shifts

#### Scenario: A repeated status publish carries the same warning

- **WHEN** a later status publish again carries a warning already delivered to
  this session
- **THEN** no additional notification is filed for it

### Requirement: One occurrence, one record

Each distinct warning occurrence SHALL produce exactly one notification, and
that notification SHALL remain a readable record afterwards, retrievable
through whatever notification surface a contributing plugin provides.

#### Scenario: The warning clears itself

- **WHEN** a warning stops being reported by the session's status
- **THEN** its notification SHALL remain filed unchanged, because the record
  is a log of what arrived, not a mirror of live state

#### Scenario: The same condition recurs

- **WHEN** a warning that had cleared is reported again later
- **THEN** a new notification SHALL be filed for the new occurrence, and the
  earlier record SHALL remain

#### Scenario: A long warning is recorded

- **WHEN** a warning's message exceeds the notification message limit
- **THEN** the notification SHALL carry the truncated text and SHALL mark
  itself as truncated, so a shortened record never reads as a complete one

## REMOVED Requirements

### Requirement: A durable off-switch stays reachable through the record

**Reason**: the built-in drawer that hosted dismissal was removed with the
owner's Wave D ruling; the dismissal route and client API stay contract-pinned
for a future plugin page, and keeping a reachability requirement against a
surface that does not exist would make the spec lie.

**Migration**: a plugin page that lists session notifications restores the
off-switch by calling the pinned dismissal route; until then the off-switch is
applied only by the underlying agent's own surfaces.
