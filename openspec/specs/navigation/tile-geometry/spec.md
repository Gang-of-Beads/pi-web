# tile-geometry Specification

## Purpose

Guarantees that tiled lists render as a designed grid rather than an accident
of their content: tiles in a row share a height, titles occupy a fixed number
of lines at every width, and only column count responds to the viewport.

## Requirements

### Requirement: Tiles in a row share a height

Within one tiled list, every tile in a visual row SHALL render at the same
height. A tile's height SHALL NOT depend on the length of its title or the
presence of its metadata.

#### Scenario: Mixed content in one row

- **WHEN** a row contains one tile with a short title and one with a long
  title and metadata
- **THEN** both tiles SHALL render at the same height, measured equal in the
  live browser

### Requirement: The title clamp does not vary by viewport

A tile's title SHALL clamp to the same number of lines at every viewport
width. Narrow screens MAY reduce column width and count, and SHALL NOT change
the title clamp.

#### Scenario: The same list on phone and desktop widths

- **WHEN** the same tiled list renders at 393px and at desktop width
- **THEN** the title line clamp SHALL be identical in both, and only the
  number and width of columns may differ
