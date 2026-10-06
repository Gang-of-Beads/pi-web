# One list component for plugin pages

Status: approved 2026-10-06 (ask `cf0b6d6f`, mockups `rows.png`, `updates.png`,
`terminal.png`). The decisions are recorded under "Decided"; the open questions at the end
are kept for the record of what was asked.

Owner, on the Background and Subagents pages: "这些页面都是插件自己写的吧？列表页可以给个统一的格式或者组件库之类的".

## What exists today

The host already hands plugins shared *styles* through `PluginHostUi`: `surfaceStyles`,
`listStyles`, `workspacePanelStyles`, `textStyles`, and two icons. Every plugin still writes
its own *markup*, so the styles only help when a plugin happens to use the same class names.
Ten bundled plugins draw lists; two (workspaces, machines) adopt `listStyles`. The rest
drift:

| Plugin | What its list looks like now |
|---|---|
| subagents | bare spans with unstyled classes: agent, status, detail and task run together |
| background-runs | its own `.task` rows and colours, written last round instead of reusing anything |
| relays, goals, updates, info, git | each its own row classes and spacing |
| workspaces, machines, projects | navigation lists on `listStyles`, with pins, badges and menus |

Shared CSS cannot fix this, because the drift is in the markup.

## Proposal

The host renders the list; the plugin supplies data.

**Boundary.** A core module `src/client/src/components/pluginList/` owns one element and one
pure model. `PluginHostUi.renderList(model)` returns the template. The plugin never writes
row markup or row CSS, and the core learns nothing about the plugin's domain: it only sees
titles, labels and tones.

**Model.**

```ts
interface PluginListModel {
  read: "reading" | "failed" | "ready";     // absence is not negation: an empty list is "none" only when ready
  emptyText: string;                          // the plugin's words for "none"
  failedText?: string;                        // the plugin's words for "could not read"; stale rows stay, marked
  groups: { heading?: string; rows: PluginListRow[] }[];
  hidden?: number;                            // "N older not shown"
}
interface PluginListRow {
  id: string;
  title: string;                              // wraps to two lines, never one-line ellipsis only
  status?: { label: string; tone: "running" | "done" | "problem" | "waiting" | "unknown" };
  detail?: string;                            // one muted line: duration, exit code, model...
  onSelect?: () => void;                      // present = the row is a 44px touch target
}
```

**Row anatomy (fixed).** Tone dot, then the title (up to two lines), then the status label
right-aligned, then the detail on a muted line underneath. Dividers between rows, the shared
reading edge on both sides, group headings, the "N not shown" footer, and one honest line
for reading, failed and empty. The tone-to-colour table lives in the core, once, so
"running" is the same colour in every plugin and on the status line.

**Guard.** A contract test enumerates every state of the model, and a producer guard fails
when a bundled plugin declares its own row classes or row CSS in a list surface.

## Adoption

1. Status lists: background-runs and subagents. They have the same shape and are the two
   the owner is looking at.
2. goals, updates, relays, info, and git's lists.
3. Navigation lists (projects, workspaces, machines) have pins, badges and row menus. They
   either move once the model grows those, or stay on `listStyles` as their own family.

## Decided (owner, 2026-10-06)

| Question | Answer |
|---|---|
| Row style | **Grouped list**: rows inside one rounded group per section, a hairline between rows, the section title above the group. Not one card per row. |
| Which pages | **Status pages**: background-runs, subagents, goals, updates, relays, info, git's lists. Navigation lists (projects, workspaces, machines) stay on `listStyles`. |
| Empty page | **A centered dashed box** carrying the plugin's words for "none"; the same box carries "reading" and "could not read". |
| Updates page | **As mocked**: a PI WEB group (version, latest, installed from, the action buttons) and a Services group (web and session daemon with their running versions and restart buttons). No command text on the page. |
| Nix install, no update command saved | Say "managed by your nix configuration" and link to the Settings field where the command is saved. No command text. |
| Terminal keys | Termux's two rows of seven docked at the bottom of the terminal, with `/` and `-` replaced by ^C and `|`; CTRL and ALT are one-shot modifiers. |

The mockup's row anatomy is the model: title left, a status pill (tone dot and label) or a
muted value right, a muted detail line under both. A group may end in an action row of
buttons. "Running" is green, as in the mockup and the working status line. Tapping a row
stays without an action until the owner asks for one.

## Decisions for the owner (asked 2026-10-03, answered above)

1. Scope: status lists only (waves 1-2), or navigation lists too (wave 3)?
2. Is the Background row shape the standard?
3. The colour of "running": green like the working status line, purple like the background
   note, or the accent?
4. Tapping a row: nothing for now, or open the item's detail? The daemon already serves
   background-task output and subagent results; no page shows them.
