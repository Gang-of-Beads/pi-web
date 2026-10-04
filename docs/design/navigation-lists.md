# Navigation and session lists

Status: approved by the owner (2026-10-04). Covers B37, B39, B43, B45,
B46 and the switcher-rank item; extends D8 in `state-diagram.md`.

## 1. The grid key (B46)

Today: on a chat or plugin page the key opens Navigate. On Navigate it is drawn
pressed; it closes Navigate only when the reader came from a page and the list
shows everything, and otherwise "shows everything", which on the machine-wide
list is a no-op (measured on 8505).

The key becomes a two-place toggle between Navigate and the page the reader came
from:

| Where | Has a page to return to | The key |
|---|---|---|
| a chat or plugin page | - | opens Navigate and remembers this page |
| Navigate | yes | drawn pressed; returns to that page (one back step, D8) |
| Navigate | no (boot, a link straight to Navigate) | a "you are here" mark, not drawn as a button and not focusable |

Widening the list to the whole machine moves off the key (section 2), so the key
has one meaning everywhere.

## 2. Getting to all sessions on the machine

Today the list widens from a project to the whole machine through the path's
first step ("Local"), which the owner found hard to find.

Proposal: when a project is chosen, the Sessions list's header carries a
two-part switch, **`<project>` | `All projects`**. One tap widens or narrows;
the path stays as the place indicator. On the machine-wide list the switch shows
`All projects` selected and the project part names the last project, so one tap
goes back.

## 3. Project views without opening a chat (B37, B39)

The owner's proposal: when a project is chosen, the top right of Navigate gets
the same three-bar menu the chat has.

Agreed, with two details:

- The menu acts on the project's workspace. PI WEB has no worktree concept in
  core (it was removed; a plugin can add one), so a project has one workspace
  and there is nothing to choose.
- The menu gets an **Actions…** line that opens the action palette, which is
  the touch opener B39 asks for (today only ⌘K opens it). It goes last, under a
  divider, after the views (Files, Git, Terminal, Tasks): the views are places,
  Actions is a command list, and the chat's menu gets the same line in the same
  place so both menus read the same.

On the machine-wide list (no project chosen) there is no menu: Files, Git,
Terminal and Tasks have no workspace to act on.

## 4. Sections in every session list (B43)

Every list of sessions (Navigate's Sessions, a project's sessions, the quick
switcher, Go to) is built from the same sections, each foldable, with its fold
state remembered per list:

1. **Pinned**
2. **Active** (everything not pinned and not archived)
3. **Archived**, last, folded by default, with its count: "Archived (179)". At
   zero it still shows ("Archived (0)"), and unfolded it says "Nothing archived
   yet".

The "Waiting for you" and "Working" sections go: what they did becomes the
order inside a section (section 5).

**Plugins can add sections.** A browser plugin contributes
`{ id, title, order, claims(session) }`. A session lands in the first section,
by `order`, that claims it. Core's sections are Pinned (100), Active (500) and
Archived (900); a plugin picks an order between them (for example, a goal
plugin's "Goal" section at 200). One classifier decides the section, so every
list agrees.

## 5. Order inside a section

The owner's proposal, checked against the states the classifier knows
(`sessionActivityCategory`: error, asking, working, background, idle) and the
unread flag:

| Rank | State | Why it is here |
|---|---|---|
| 1 | **error** | the run ended badly; the reader must act |
| 2 | **asking** (a question, a dialog, a confirmation) | the agent is blocked on the reader |
| 3 | **idle, unread** | a finished reply the reader has not seen |
| 4 | **working** or **background** (a background task or subagent runs while the turn is idle) | nothing for the reader to do yet |
| 5 | **idle, read** | done and seen |

The order agrees with the proposal; the one addition is that `background` ranks
with `working`.

Within a rank, newest **last activity** first. Last activity is the latest of:
the machine accepting a user message, a run ending, and the session entering
error or asking. Streaming text, tool steps and status ticks inside a run do not
move it, so a working session keeps its place until its run ends, then moves
once.

Rows move live when a session's rank or last activity changes. A row does not
move while the reader's pointer is down on the list, or within 600 ms of a tap,
so a list never shifts under a finger; the pending moves apply right after.

## 6. The desktop first-boot centre (B45)

Words: "Open a session on the left, or start a new one."

The button depends on what exists, because a session needs a project and a
workspace:

| What exists | Button | What it does |
|---|---|---|
| no project | **Add a project** | opens the Add project dialog; after it is added, a new session starts in its main checkout |
| projects, and a most recently used one | **New session in `<project>`** | starts a session in that project's main checkout and opens it |
| projects, none used yet | **New session…** | opens the Projects list to choose one; choosing starts the session there |

A small "Choose another project" link sits under the second form.

## Order of work

1. The grid key toggle (client).
2. The sections and the order classifier, used by every list; the plugin
   contribution point in `plugin-api.ts`.
3. The `<project> | All projects` switch.
4. The project menu with Actions….
5. The first-boot centre.
