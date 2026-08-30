## Purpose

Guarantees that a surface the user has settled - answered, dismissed, or
otherwise resolved - leaves the screen without charging another interaction,
while its outcome stays retrievable; and that nothing settled can become a
permanent occupant of the viewport.

## ADDED Requirements

### Requirement: Settling is complete in itself

When the user answers a dialog or question, the answer SHALL be the last
interaction that surface requires. The surface SHALL leave the waiting area on
its own, and the outcome SHALL be filed where session notifications live, where
it can be read back.

#### Scenario: A dialog is answered

- **WHEN** the user answers an extension dialog
- **THEN** no further tap SHALL be needed to put it away, and the outcome
  SHALL appear in the session's notification record

#### Scenario: Nothing settled squats on the screen

- **WHEN** any surface reaches a settled state
- **THEN** it SHALL NOT remain fixed in the viewport indefinitely; whatever
  remains visible SHALL scroll with the content it belongs to

### Requirement: A settled surface cannot be revived by stale state

A snapshot of session state older than the settlement SHALL NOT re-open the
surface or resurrect its card.

#### Scenario: An old snapshot arrives after the answer

- **WHEN** a status snapshot built before the user's answer is applied after it
- **THEN** the answered surface SHALL remain settled
