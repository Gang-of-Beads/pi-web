# touch-interaction Specification

## Purpose

Guarantees that on a touch screen one tap activates the control it lands on,
by forbidding the styling behaviour that makes browsers withhold a first tap.

## Requirements

### Requirement: One tap activates

On a coarse pointer, a single tap on an enabled control SHALL activate it.
No control SHALL require a first tap to change appearance and a second to act.

#### Scenario: A dialog option is tapped once

- **WHEN** the user taps an option button or a dismiss control once on a
  coarse-pointer device
- **THEN** the control SHALL activate on that tap

### Requirement: Hover styling is confined to devices that hover

A `:hover` style SHALL apply only under `@media (hover: hover)`. Touch
feedback SHALL use `:active`; keyboard focus SHALL use `:focus-visible`.
A hover rule outside the guard SHALL fail the automated suite, so the rule
cannot grow back one file at a time.

#### Scenario: An unguarded hover rule is introduced

- **WHEN** a change adds a `:hover` selector outside `@media (hover: hover)`
- **THEN** the suite SHALL fail naming the file and line
