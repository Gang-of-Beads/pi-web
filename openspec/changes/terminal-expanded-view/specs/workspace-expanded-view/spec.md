## Purpose

Provide one reversible, shareable full-canvas desktop presentation for every Workspace Panel tool while preserving each tool's scoped state and responsive behavior.

## ADDED Requirements

### Requirement: Every desktop Workspace Panel tool can use the full application canvas
The shared Workspace Panel SHALL provide one control that expands the panel across the desktop application canvas and one control in the same stable header location that exits the expanded layout. Expansion SHALL preserve the selected machine, project, workspace, tool, and tool-owned state.

#### Scenario: User expands a workspace tool
- **WHEN** the user selects Expand panel while viewing any desktop Workspace Panel tool
- **THEN** the navigation and chat panes SHALL be hidden, the Workspace Panel SHALL occupy the application canvas, and the shared control SHALL change to Exit expanded view

#### Scenario: User switches workspace tools while expanded
- **WHEN** the user selects another Workspace Panel tool while expansion is active
- **THEN** the newly selected tool SHALL remain in the same expanded Workspace Panel and the shared exit control SHALL remain reachable

#### Scenario: User exits expanded Workspace Panel
- **WHEN** the user selects Exit expanded view
- **THEN** the complete ordinary desktop shell SHALL return without resetting the active tool's domain state

#### Scenario: User views workspace tools on a mobile layout
- **WHEN** the selected tool already owns the available mobile application surface
- **THEN** the Workspace Panel SHALL NOT expose a redundant expansion control and existing mobile tool controls SHALL remain reachable at the coarse-pointer target floor

### Requirement: Expanded Workspace Panel state is scoped and shareable
The application SHALL encode expansion once in Workspace Panel route state alongside the existing machine, project, workspace, selected tool, and tool-specific route state. It SHALL restore expansion only when the URL identifies a matching active Workspace Panel surface.

#### Scenario: User refreshes an expanded workspace route
- **WHEN** an expanded Workspace Panel URL is refreshed for the same machine, project, workspace, and tool
- **THEN** the application SHALL restore that tool and the expanded canvas

#### Scenario: User shares an expanded workspace route
- **WHEN** another browser opens a valid expanded Workspace Panel URL
- **THEN** it SHALL resolve the same scoped workspace and tool before applying expansion

#### Scenario: Browser history leaves the expanded workspace surface
- **WHEN** browser back or forward navigates to a route that does not select an expanded Workspace Panel
- **THEN** the shell SHALL restore the layout represented by that route and SHALL NOT retain stale expansion


### Requirement: Terminal geometry follows shared layout transitions
When Terminal is the active tool, entering or leaving the shared expanded layout SHALL refit the visible terminal and report the resulting columns and rows through the existing terminal resize channel.

#### Scenario: Expanded canvas changes terminal dimensions
- **WHEN** the shared Workspace Panel completes an expand or exit transition with Terminal active
- **THEN** xterm SHALL fit the resulting visible container and the active PTY SHALL receive the updated terminal dimensions without recreating the terminal process
