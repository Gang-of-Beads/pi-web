## Purpose

Provide a reversible, shareable full-canvas desktop terminal surface that preserves terminal identity and keeps the PTY geometry aligned with the visible browser layout.

## ADDED Requirements

### Requirement: Desktop terminal can use the full application canvas
The Terminal workspace tool SHALL provide a control that expands the active terminal panel across the application canvas on desktop and a control in the same terminal surface that exits the expanded layout. Expansion SHALL preserve the selected terminal, terminal process, output, input capability, copy mode, and command-run state.

#### Scenario: User expands an active terminal
- **WHEN** the user selects Expand terminal in the desktop Terminal workspace tool
- **THEN** the navigation and chat panes SHALL be hidden, the Terminal workspace panel SHALL occupy the application canvas, and the control SHALL change to Exit expanded terminal

#### Scenario: User exits expanded terminal
- **WHEN** the user selects Exit expanded terminal
- **THEN** the ordinary desktop shell layout SHALL return without recreating or changing the selected terminal process

#### Scenario: User leaves the Terminal tool while expanded
- **WHEN** the user selects another workspace tool or otherwise disconnects the active Terminal panel
- **THEN** the shell SHALL exit its expanded presentation so the new surface retains a reachable exit and normal navigation

#### Scenario: User views Terminal on a mobile layout
- **WHEN** the selected workspace tool already owns the available mobile application surface
- **THEN** the Terminal panel SHALL NOT add a redundant expanded-layout control

### Requirement: Expanded terminal state is scoped and shareable
The application SHALL encode expanded terminal state in the Terminal route namespace alongside the existing machine, project, workspace, selected terminal, tool, and view route state. It SHALL restore the expanded state only when the URL identifies the matching active Terminal workspace surface.

#### Scenario: User refreshes an expanded terminal route
- **WHEN** an expanded Terminal URL is refreshed for the same machine, project, workspace, and selected terminal
- **THEN** the application SHALL restore the Terminal tool, selected terminal, and expanded canvas

#### Scenario: User shares an expanded terminal route
- **WHEN** another browser opens a valid expanded Terminal URL
- **THEN** it SHALL resolve the same scoped Terminal workspace and selected terminal before applying the expanded presentation

#### Scenario: Browser history leaves expanded terminal
- **WHEN** browser back or forward navigates to a route that does not select the expanded Terminal surface
- **THEN** the shell SHALL restore the layout represented by that route and SHALL NOT retain stale terminal expansion

### Requirement: Terminal geometry follows layout transitions
After entering or leaving the expanded layout, the visible terminal SHALL refit to its new container and SHALL report the resulting columns and rows through the existing terminal resize channel.

#### Scenario: Expanded canvas changes terminal dimensions
- **WHEN** the Terminal panel completes an expand or exit layout transition
- **THEN** xterm SHALL fit the resulting visible container and the active PTY SHALL receive the updated terminal dimensions
