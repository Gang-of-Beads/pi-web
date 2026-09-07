# pending-input-stability DELTA

## MODIFIED Requirements

### Requirement: The shipped tab strip holds its geometry under observation

The drawer tab strip SHALL be demonstrated, in a real browser at 393x850 with
a coarse pointer, to keep its membership and geometry while the drawer's
content changes - a contributed section's badge draining to zero and
refilling, or a section arriving and leaving - so a reader reaching for a tab
never has the strip move under the finger.

#### Scenario: Badges drain and refill under observation

- **WHEN** a contributed section's badge count is driven from n to zero and
  back while the strip is on screen
- **THEN** the strip's tabs, their order and their positions SHALL be
  unchanged, shown by measurements or screenshots from the live browser

#### Scenario: Membership follows contributions only

- **WHEN** a plugin contributes a drawer section or withdraws one while the
  drawer is open
- **THEN** the strip's membership SHALL change exactly with the contributed
  sections, and no built-in tab SHALL appear to keep the strip populated
