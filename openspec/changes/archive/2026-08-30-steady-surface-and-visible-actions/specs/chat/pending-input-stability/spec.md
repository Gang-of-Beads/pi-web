## Purpose

Guarantees that a surface waiting for the user's input stays where the user last
saw it, and that the area between the transcript and the composer does not change
height while content arrives, so that a person can aim at a control on a phone
while the agent is writing.

## ADDED Requirements

### Requirement: A surface awaiting input keeps its position

While a question card, an extension dialog, or any control that is waiting for
the user's answer is on screen, its position in the viewport SHALL NOT change
because content arrived, changed, or was removed elsewhere in the session.

This holds regardless of the producer. Producers observed in this product
include: an assistant reply streaming token by token; tool call and result rows
being appended; goal continuations being injected; background task notifications
arriving as new turns; the activity strip changing height; notification cards
arriving; the queued-message strip appearing or disappearing; the drawer tab
strip gaining or losing a tab; compaction summaries being inserted; images and
attachments finishing load; and markdown blocks reflowing after paint.

#### Scenario: A reply streams while a question waits

- **WHEN** a question is awaiting the user's answer and an assistant reply is
  streaming into the same session
- **THEN** the question's controls SHALL remain at the same viewport position
  for the whole stream, and a tap aimed at an option SHALL activate that option

#### Scenario: A late producer arrives mid-press

- **WHEN** the user's finger is down on a control of a waiting surface and any
  content elsewhere in the session arrives, changes, or is removed
- **THEN** the control under the finger at press time SHALL be the control that
  receives the activation

#### Scenario: The question outlives an unrelated turn

- **WHEN** turns begin and end in the session while a question remains
  unanswered
- **THEN** the question SHALL remain answerable and SHALL NOT be scrolled or
  displaced out of reach by those turns

### Requirement: The region below the transcript holds a constant height

The area between the transcript and the composer SHALL keep a constant height
while a reply streams. Any element in that area that can appear, disappear, or
change size SHALL reserve its space, so that its absence and its presence
occupy the same geometry.

#### Scenario: The streaming status changes text

- **WHEN** the streaming status row updates, including its elapsed-time text
  growing from seconds to minutes
- **THEN** the height of the region below the transcript SHALL NOT change

#### Scenario: The queued strip appears and clears

- **WHEN** a queued message strip appears, updates its count, or clears
- **THEN** the composer and every control below the transcript SHALL stay at
  the same viewport position

#### Scenario: An outcome settles

- **WHEN** an answered or cancelled surface settles, collapses, or leaves
- **THEN** the departure SHALL NOT move any control that the user could be
  reaching for, and SHALL NOT happen while a pointer is down on that region

### Requirement: A surface that stops waiting has somewhere to go

A surface that is no longer waiting for the user SHALL leave the waiting area
and SHALL remain retrievable afterwards. No waiting surface SHALL become a
permanent occupant of the screen, and no affordance that removes a surface
SHALL be withdrawn unless the surface leaves on its own.

#### Scenario: An answered question leaves

- **WHEN** the user answers a question
- **THEN** the waiting area SHALL release the space it occupied, and the
  outcome SHALL remain readable in the session's notification record

#### Scenario: A settled question cannot be revived

- **WHEN** a snapshot of session state that predates the answer arrives after it
- **THEN** the answered question SHALL NOT reappear as waiting
