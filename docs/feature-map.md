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
| Chat, Files, Terminal panels | Workspace tool strip; mobile tab strip; `⌘1/2/4`; `?tool=` | Same surfaces, restyled; the mobile strip becomes a single overflow-aware bar (task-7) |
| Session list, search, start, archive, rename, restore, delete | Session list rows and its `⋯` menu | Same, plus right-click (desktop) and long-press (touch) opening the same menu |
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
| **Open settings** | `⌘,`, palette, `?settings=` — no button anywhere | Visible control in the app header / context bar |
| Keyboard shortcut rebinding | Settings ▸ Shortcuts, itself invisible | Same panel, now reachable from the visible settings control |
| **Theme selection** | Palette action only | Settings ▸ Appearance with live preview and a follow-system switch (task-8) |
| Provider auth (login/logout) | Palette only; usually discovered via an error | Settings ▸ Providers, plus the existing error-driven prompt |
| **Session tree navigator** (history, branches, fork) | Only by typing a `/tree` command | Session row context menu and the chat header |
| Machine refresh / open remote PI WEB | Palette only | Machine row context menu, and the fleet panel |
| Machine add / remove | Palette; row `⋯`; Settings ▸ Machines | Adds an inline `+` on the machines section (task-5) |
| Fleet status, update, restart across machines | `/pi-web` slash command only | Fleet panel listing every machine with version, online state and per-machine update/restart (task-4) |
| Panel size reset (×3 actions) | Palette only, duplicating an undocumented double-click | Context menu on the panel edge control; palette entries stay |
| Refresh current panel | `⌘⇧R` only | Kept, plus the existing per-panel refresh buttons |
| Session bulk selection | Long-press with no hint | Explicit select control in the session list header |
| Workspace trust toggle and details | Inside the workspace row `⋯` menu | Same menu, surfaced as a workspace detail sheet with the trust state visible on the row |
| Project add | Palette (desktop); quick action (mobile) | Inline `+` on the projects section |
| Workspace add / remove | Palette; row menu | Inline `+`, row context menu |
| New session | `⌘⇧N`, list button, quick action | Inline `+` on the sessions section |
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

## Rules this map enforces

1. Nothing on this page loses its ability to be reached. A row may gain an entry
   point; it may not lose its last one.
2. Anything reachable only from the palette, only from a URL, or only from a
   typed command counts as not discoverable, and needs a second way in.
3. When a capability moves, the old shortcut or URL keeps working.
