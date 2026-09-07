# panel-load-honesty DELTA

## REMOVED Requirements

### Requirement: Notifications distinguish loaded from not loaded and failed

**Reason**: the built-in notifications panel was removed with the owner's Wave
D ruling; there is no shell surface left whose empty, failed and unread states
this requirement could govern. The honesty rules it carried (an empty claim
only after a completed, matching read; a failed read names the failure; unread
never presents as empty) remain binding on any plugin page that lists session
notifications, and are restated in the session-drawer contract this change
adds.

**Migration**: a contributing plugin's notification page re-implements these
states against its own read; the deleted shell panel's behaviour is preserved
in the change history.

## ADDED Requirements

### Requirement: The session drawer is contributed-sections-only

The session drawer SHALL render exactly the sections contributed by plugins,
with the reader's own section choice surviving until they change it. When no
plugin contributes a section, the drawer SHALL NOT render at all - no frame,
no tab strip, no toggle - and the shell SHALL NOT present built-in Activity or
Notifications tabs.

#### Scenario: No plugin contributes a section

- **WHEN** the machine's plugin set contributes no drawer section
- **THEN** the session drawer renders nothing: no frame, no tabs, no toggle,
  and no empty claim standing in for the removed pages

#### Scenario: A plugin contributes a section

- **WHEN** a plugin contributes a drawer section on this machine
- **THEN** the drawer shows exactly that section's tab, and the section
  itself owns its empty, failed and loading states
