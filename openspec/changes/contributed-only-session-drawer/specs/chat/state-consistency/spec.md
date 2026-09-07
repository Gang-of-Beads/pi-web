# state-consistency DELTA

## MODIFIED Requirements

### Requirement: A detected gap is repaired from the server

When the client detects a gap in a scope, it SHALL resynchronize that scope from
the server and then resume applying live frames, so that the view converges on
the server's state. Repair SHALL be bounded in time, SHALL NOT duplicate content
already shown, and SHALL NOT require the reader to reload the page.

Two repair shapes are admissible, to be chosen per surface by the design: replay
of the missed frames from a cursor the client supplies, or a full resync of the
scope keyed by a revision check on the scope's own join snapshot. A repair that cannot
complete SHALL be reported to the reader in the surface it affects, following
the honesty rules of the panel states.

#### Scenario: A lost transcript frame mid-stream

- **WHEN** a transcript frame is missed while a reply is streaming
- **THEN** the client SHALL repair the transcript to the server's content and
  resume streaming without duplicating what was already shown
