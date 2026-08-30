## Purpose

Live-evidence obligations for the two stability behaviours that were built
before their spec existed: the fixed tab strip and the waiting row. The base
requirements live in the steady-surface change; these deltas bind the
implementations that already shipped to evidence from the owner's conditions.

## ADDED Requirements

### Requirement: The shipped tab strip holds its geometry under observation

The drawer tab strip SHALL be demonstrated, in a real browser at 393x850 with
a coarse pointer, to keep its membership and geometry while a tab's count
drains to zero and refills.

#### Scenario: Counts drain and refill under observation

- **WHEN** the notification count is driven from n to zero and back while the
  strip is on screen
- **THEN** the strip's tabs, their order and their positions SHALL be
  unchanged, shown by measurements or screenshots from the live browser

### Requirement: The shipped waiting row holds position under observation

The waiting row SHALL be demonstrated, in a real browser at 393x850, to hold
a question's controls at a fixed viewport position while a reply streams into
the same session, and a tap during the stream SHALL activate the control it
lands on.

#### Scenario: A question waits through a streamed reply

- **WHEN** a question is open in the waiting row and a reply streams
- **THEN** the question's controls SHALL not move for the duration, measured
  in the live browser, and a mid-stream tap SHALL activate the intended
  control
