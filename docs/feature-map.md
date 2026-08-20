# Feature map: every capability, and where it lives after the redesign

The navigation redesign moves things. This table exists so that "moved" never
becomes "lost": every capability the app has today appears here with its current
entry point and its intended one. A capability may change shape; it may not
disappear.

Inventory taken on branch `redesign/ia-and-multi-machine` (August 2026) from
`src/client/src/`. Discoverability is judged from a cold start: can someone who
has not read the source find it?

## Reachable and staying put

These already have a visible, obvious entry point. The redesign restyles them
but does not move them.

| Capability | Entry point today | After |
|---|---|---|
| Chat, Files, Terminal panels | Workspace tool strip; mobile tab strip; `⌘1/2/4`; `?tool=` | Desktop tool strip unchanged; on mobile ✅ a "Go to a view" sheet listing every view **by name** replaced the icon strip (`AppMobileToolSheet`) |
| Session list, search, start, archive, rename, restore, delete | Session list rows and its `⋯` menu | Same; machine/project/workspace rows gained right-click and long-press onto their menus, and the mobile session sheet has its own row menu with pin and rename |
| Quick switcher | `⌘P`, context bar, mobile quick action | Same |
| Actions palette | `⌘K`, "Actions" button, context bar | Same; stops being the only home for things listed below |
| Model and thinking-level pickers | Composer chips; palette | Same |
| Stop / send / queue controls | Composer | Same |
| Ask-user cards, extension dialogs, image zoom | Inline in the transcript | Same |
| File upload, file viewer, preview/raw toggle | Files panel | Same |
| Session cleanup | "Clean up" in the session list header | Same |
| Self-update and deprecation banners | Automatic | Same |
| Back gesture, modal dismissal | Browser back, Escape, backdrop | Same |

## Reachable only if you already know

The problem set. Each row keeps its current entry point (nothing is removed) and
gains a visible one.

| Capability | Entry point today | After |
|---|---|---|
| **Open settings** | `⌘,`, palette, `?settings=` — no button anywhere | ✅ gear control in the navigation panel header (`AppNavigationPanel`) |
| Keyboard shortcut rebinding | Settings ▸ Shortcuts, itself invisible | Same panel, now reachable from the visible settings control |
| **Theme selection** | Palette action only | ✅ Settings ▸ Appearance: every contributed theme as a card with a live colour preview, plus a follow-the-system switch (`SettingsAppearancePanel`) |
| Provider auth (login/logout) | Palette only; usually discovered via an error | Settings ▸ Providers, plus the existing error-driven prompt |
| **Session tree navigator** (history, branches, fork) | Only by typing a `/tree` command | ✅ "History and branches" in the session row menu (`SessionList`), which runs the same command |
| Machine refresh / open remote PI WEB | Palette only | ✅ "Check again" / "Open PI WEB" in the machine row menu, plus the fleet panel |
| Machine add / remove | Palette; row `⋯`; Settings ▸ Machines | ✅ inline `+` on the machine step of the context row |
| Fleet status, update, restart across machines | `/pi-web` slash command only | ✅ Settings ▸ Machines ▸ "Machines and updates" (`SettingsFleetSection`) |
| Panel size reset (×3 actions) | Palette only, duplicating an undocumented double-click | Context menu on the panel edge control; palette entries stay |
| Refresh current panel | `⌘⇧R` only | Kept, plus the existing per-panel refresh buttons |
| Session bulk selection | Long-press with no hint | Explicit select control in the session list header (the header's checkbox); long-press keeps entering selection here, while the other lists use long-press for their row menu |
| Workspace trust toggle and details | Inside the workspace row `⋯` menu | Same menu, surfaced as a workspace detail sheet with the trust state visible on the row |
| Project add | Palette (desktop); quick action (mobile) | ✅ inline `+` on the project step of the context row |
| Workspace remove | Palette; row menu | ✅ row menu, now also opened by hold / right-click. **No workspace create exists**: workspaces come from a provider and the server has no create endpoint, so no `+` is offered rather than a button that cannot work |
| New session | `⌘⇧N`, list button, quick action | ✅ inline `+` in the session list header (unchanged) |
| Goals: refresh | Button in the goal panel | Same, plus archive/clear (task-6) |
| Dictation | Composer, only when speech-to-text is configured server-side | Same, with the reason shown when it is unavailable rather than the control vanishing |
| Deep links (`?tool=`, `?view=`, `?settings=`) | URL only, undocumented ids | Unchanged; documented in the settings panel that owns each id |
| `⌘3` | Unassigned — the numeric view shortcuts skip it | Assign to the third workspace panel so the mapping is learnable |

## Programmatic and plugin surfaces

Not user-facing; listed so a redesign does not break them.

| Surface | Notes |
|---|---|
| Plugin runtime API (`piWebUnstable`: insert prompt text, open settings, select main view, open terminal, workspace tools, terminal command runs) | Must keep working; the settings opener now also has a UI equivalent |
| Plugin-contributed panels and actions | Appear in the same tool strip and palette as built-ins |
| Code viewer | Embedded by the file viewer; no direct entry point by design |

## Placed so far

The context row (`AppContextSwitcher`) replaced the stacked machine/project/
workspace sections: it names the current context, opens each picker into the
panel body, and carries the inline create controls. The session list keeps the
body the rest of the time. Rows answer hold (touch) and right-click (mouse) with
the menu their `⋯` button opens.

Still to place, by task: panel-size resets and the unassigned `⌘3`
(task-9 cleanup).

## Rules this map enforces

1. Nothing on this page loses its ability to be reached. A row may gain an entry
   point; it may not lose its last one.
2. Anything reachable only from the palette, only from a URL, or only from a
   typed command counts as not discoverable, and needs a second way in.
3. When a capability moves, the old shortcut or URL keeps working.
