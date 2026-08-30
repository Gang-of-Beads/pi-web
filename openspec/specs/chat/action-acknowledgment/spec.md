# action-acknowledgment Specification

## Purpose

Guarantees that every action a user takes reports back what happened to it -
received, waiting, running, finished, or failed - so that a person never has to
guess whether the app heard them, and never retries a destructive action because
silence looked like failure.

## Requirements

### Requirement: Every user action acknowledges itself

Any control a user activates SHALL show, within the same interaction, that the
activation was received. The acknowledgement SHALL be visible without the user
scrolling, opening a panel, or waiting for an unrelated refresh.

An action that produces no visible change is indistinguishable from a broken
one, and users retry it: the goal Resume button was pressed four times, and an
update prompt more than ten times, because each press was silent.

#### Scenario: A press is received

- **WHEN** the user activates a control that starts work
- **THEN** the control SHALL report immediately that the action was taken, and
  SHALL NOT rely on the next background refresh to show it

#### Scenario: A press cannot be repeated by accident

- **WHEN** an action is already in flight
- **THEN** the control SHALL show that it is in flight, and repeated activation
  SHALL NOT start additional copies of the same work

### Requirement: An accepted action that cannot run yet says so

When an action is accepted but cannot take effect until other work finishes,
the app SHALL state that it is waiting and what it is waiting for. Acceptance
SHALL NOT be represented as completion, and waiting SHALL NOT be represented as
silence.

#### Scenario: A command waits for the running turn

- **WHEN** the user issues a command while the session is producing a reply
- **THEN** the app SHALL show the command as accepted and waiting for that reply
  to finish, and SHALL show it running and then finished when it proceeds

#### Scenario: The goal panel acts through a waiting command

- **WHEN** the user presses a goal control while a reply is streaming
- **THEN** the press SHALL be acknowledged at once, and the goal's state SHALL
  NOT be redrawn as unchanged in a way that implies the press was lost

### Requirement: Commands are visible work

A command issued by the user, whether typed or issued by a control on their
behalf, SHALL appear in the session transcript with an explicit state of
queued, running, or finished, and its outcome SHALL be recorded there.

#### Scenario: A typed command is issued

- **WHEN** the user sends a command
- **THEN** the transcript SHALL carry a row for it from the moment it is issued
  until its result is known

#### Scenario: A command fails

- **WHEN** a command fails or is refused
- **THEN** the failure and its reason SHALL be shown where the command was
  issued, and SHALL NOT be reported as a silent no-op

### Requirement: A withdrawn question states why it was withdrawn

When a question the user has not answered is cancelled, voided, or superseded,
the app SHALL state which event caused it and SHALL preserve what the user had
already entered.

#### Scenario: The user types instead of answering

- **WHEN** an unanswered question is voided because the user sent a message
  instead of answering it
- **THEN** the card SHALL say that the message replaced the question, rather
  than showing an unexplained cancellation

#### Scenario: The producer withdraws the question

- **WHEN** the extension or run that asked the question withdraws it or times
  out
- **THEN** the card SHALL name that cause and SHALL distinguish it from a
  cancellation the user performed
