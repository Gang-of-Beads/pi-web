# panel-load-honesty Specification

## Purpose

Guarantees that no panel in the app states a definitive empty result unless a
read completed for the selection the reader is looking at, so that a question
like "does this workspace have goals?" or "is anything running?" is answered
with the truth - including the truths "I have not read it yet", "the read
failed", and "this data answers for a different selection".

## Requirements

### Requirement: The four load states are named and carried with their key

Every panel that can render a definitive empty result SHALL represent its data
as one of four named states - `unloaded`, `loading`, `failed`, `loaded` -
together with the selection key (machine + project + workspace + session, as
applicable) the data was read for. A panel SHALL NOT derive any of these states
by inference from the shape of the data (for example, from an empty array).

#### Scenario: A panel distinguishes the states

- **WHEN** a panel's data slot is inspected at any moment
- **THEN** exactly one of the four states applies, and the state carries the
  key the data answers for

#### Scenario: An empty array is not a load state

- **WHEN** a read succeeds and returns zero rows
- **THEN** the state is `loaded` with zero rows, and this is the only
  circumstance in which the panel's empty claim may render

### Requirement: The empty claim requires a completed, matching read

A panel SHALL render a definitive empty claim only when the load state is
`loaded` and its key matches the current selection. While the state is
`unloaded`, `loading`, `failed`, or the key does not match, the panel SHALL
render a loading line, a failure line, or nothing - never the empty claim, and
never rows retained from another key.

#### Scenario: A read is in flight

- **WHEN** the goals panel's read has started but not returned
- **THEN** the panel shows a loading line, and the strings "No goals recorded
  for this workspace" and "No subagent or background activity from this chat
  yet." SHALL NOT be visible

#### Scenario: A read fails

- **WHEN** a panel's read fails
- **THEN** the panel names the failure and keeps any previously rendered rows
  only while their key still matches the selection; a failed first read renders
  the failure, not an empty claim

#### Scenario: The selection moves before the read lands

- **WHEN** the user changes session, workspace or machine and a read for the
  previous selection returns afterwards
- **THEN** the response is discarded or re-keyed, and the panel does not render
  it as the new selection's data

#### Scenario: A key mismatch is not emptiness

- **WHEN** a panel's data answers for a different selection than the one on
  screen
- **THEN** the panel SHALL NOT render its empty claim, and SHALL NOT render the
  mismatched rows as if they were this selection's

### Requirement: Goal reads cover the roots a goal may live in

The goals read SHALL report the root each record was read from. When the
focused session's working directory differs from the workspace root, the read
SHALL cover both, so that an active goal recorded beside the session cannot
render as "no goals recorded for this workspace".

#### Scenario: A goal lives beside the session, not the workspace

- **WHEN** the focused session's working directory contains goal records and
  differs from the workspace root
- **THEN** the goals panel lists those goals, labelled with the root they came
  from

#### Scenario: No goals after a completed read

- **WHEN** the goals read completes successfully for the matching selection and
  no records exist in any covered root
- **THEN** the panel renders "No goals recorded for this workspace", and this
  is the only path by which that string appears

### Requirement: Background tasks are attributed by their registry

A background task SHALL be attributed to the session named by its record's
location in the task registry, independent of the session transcript's
contents. An unreadable, missing, or compacted transcript SHALL NOT hide a task
whose registry record exists.

#### Scenario: The transcript no longer names the task

- **WHEN** a session's transcript has been compacted, pruned, or is
  unreadable, and a task registry record for that session reports a running
  task
- **THEN** the activity panel lists the task with its live status

#### Scenario: Nothing is running after a completed read

- **WHEN** the activity read completes for the matching session and no task or
  run is active
- **THEN** the panel renders "Nothing running right now.", and this is the
  only path by which that string appears

### Requirement: Activity absence before a first read is unknown, not empty

When the activity snapshot for the current selection has never been read
successfully, the activity panel SHALL render an unknown or loading state, and
SHALL NOT render "No subagent or background activity from this chat yet."

#### Scenario: The first poll fails

- **WHEN** the session's first activity read fails
- **THEN** the panel shows a failure or loading state, not an empty claim

### Requirement: Notifications distinguish loaded from not loaded and failed

The notification list SHALL render its empty claim only after a completed,
matching read; a failed read SHALL name the failure; an unread inbox SHALL NOT
present as an empty one.

#### Scenario: The notification read fails

- **WHEN** the notification read for the current chat fails
- **THEN** the panel names the failure instead of rendering "No notifications
  yet." or "No notifications for this chat."
