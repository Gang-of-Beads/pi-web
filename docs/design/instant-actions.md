# Archive, delete and remove act at once, with Undo

Owner, 2026-10-21: every archive, restore, delete, remove and close action is one tap with an Undo, with no second tap and no confirmation dialog. The page moves the item where it will be at once, then asks the machine and waits for its answer. If the machine refuses, or a later read shows the action did not happen, the item moves back with the reason.

## The lifecycle

`instantActions.ts` is the state machine and `InstantActionController` executes it, one executor per phase. Every pending action carries its scope: the machine whose lists it changes, and per target the project, workspace and session (or project or machine) it names.

| Phase | The rows | Leaves on | To |
|---|---|---|---|
| `optimistic` | moved | delivered, by kind | `held` or `sent` |
| `held` | moved; nothing sent | Undo | `reverted`: nothing was sent |
|  |  | the window ends, a newer action, the page hidden or unloaded | `sent` (a keepalive request when the page goes away) |
| `sent` | moved, marked "Archiving…" | the machine answers | `confirmed` for the rows it did; the rows it refused go back with its words |
|  |  | no answer, a timeout, a 5xx, a gateway's 502/503/504 | `unconfirmed` |
|  |  | Undo | `undoing` |
| `unconfirmed` | moved, marked "Not confirmed yet" | a read of the machine shows it happened | `confirmed` |
|  |  | a read made after the request's deadline shows it did not | `reverted`, with the reason |
|  |  | the machine cannot be read, or the read does not cover the row | stays, and is read again on a growing interval |
| `undoing` | back | the reverse request lands | `reverted` |
|  |  | the reverse is refused | a read decides per row: where the action still stands, `confirmed` and the app row says the undo was refused; where it does not (it never landed), `reverted` with nothing to report |
|  |  | the reverse gets no answer | `unconfirmed`, settled by a read made once the reverse can no longer be landing |
| `confirmed` | moved; the app's own lists carry it | its window ends | dropped |
| `reverted` | back; a refused row keeps a danger border and the reason for 6 s | | dropped |

A refusal is a 4xx with the machine's reason. Anything else is not an answer: the action may or may not have landed, so the row stays where it was moved until a read settles it (absence is not negation).

The reads that settle a row follow three rules:

- The first read waits 2 s, then they back off up to 30 s. Until the request's deadline (30 s) has passed, a read settles only a row it shows moved. A row still in place may yet move: a remote package removal can outlive the timeout, and a read can join one that started before the request landed.
- A read answers only for what it covers. A session missing from a whole board read is gone only when one of the board's workspaces holds its directory; a session outside every open project, and not pinned, is not in that read, so it stays "Not confirmed yet".
- A workspace removal is found by its run: the removal runs of its project are listed when Remove is pressed, and a read looks for a run for that workspace that was not in that list. A run's time is the machine's clock, which is never compared with the browser's.

Whatever the machine did is then carried into the page, whether its answer or a later read said so. A removed machine leaves the roster for good, and if it was the selected one, the page moves to the machine it would pick next. A removed Pi package tells the reader what to do next ("Type /reload in each idle PI WEB session…"): in the app row, as information about that machine shown only while that machine is on screen, and in the packages panel while Settings still shows that machine. A cleanup or a workspace removal has its lists read again.

## What is sent at once and what is held

| Action | Delivery | Undo |
|---|---|---|
| Archive (row menu, Select mode, the palette's "Archive session") | at once | sends Restore |
| Restore (row menu, Select mode, the archived strip) | at once | sends Archive |
| Delete permanently (one, or Select mode) | held for the window | nothing was sent |
| Close project (row menu, Select mode, the workspaces plugin's list) | held: a project added again gets a new id and loses its place and pins | nothing was sent |
| Remove machine (row menu, Settings, the machines plugin) | held; a browser-direct machine is also asked to forget this page's access, and the bar says "it is asked to forget this page's access" (it does so only if it answers) | nothing was sent |
| Remove Pi package (Settings › Pi Packages) | held | nothing was sent |
| Remove page access (Settings › Machines › Pages Allowed to Connect Here) | held | nothing was sent |
| Session cleanup's Run | held; the bar says what it will archive and delete for good, so the dialog no longer asks | nothing was sent |
| Remove workspace (the workspaces plugin, the palette) | held; the bar carries the provider's own warning (uncommitted work) instead of a dialog, and the removal sent is the one that warning described, with the project the press named, whatever the page shows by then | nothing was sent |

## The Undo bar

Owner, 2026-10-21: the bar at the bottom of the column that acted (`UndoBar.ts`). On the Navigate page it is the page's last row, so it sits at the bottom of the phone's screen and at the bottom of the desktop rail; an action taken outside that page (Settings, the cleanup dialog, a plugin's list) docks it at the bottom of the window, live above the dialog. The top app row carries no button (owner, 2026-10-13).

An archive or restore pressed on the Navigate page unfolds its destination section for this visit only, so the row is seen landing there; the reader's own fold choice is kept and the next visit shows it (owner, 2026-10-21). A press refused at the tap moves nothing and unfolds nothing.

Settings lists keep a removed row hidden past its action until they have read again, so a confirmed removal does not flash back, and a refused or undone one returns with that read (`settings/settledRemovals.ts`). A row is known by its machine and id together, so the same package on another machine is never hidden with it. A list whose only rows are being removed shows them gone, not as "none": until the removal is done they still exist.

- One line: what was done on the left (the verb in the danger tone for a held action), Undo on the right, the shortcut on a desktop, and a 2 px countdown line along its top edge.
- 5 s. A finger, the pointer or focus on the bar holds the countdown, and so does a hidden page for an action already sent. A press that starts on the bar holds it until the press ends wherever it ends: released or cancelled anywhere, the window losing focus, or the pointer leaving the window.
- One window at a time: a newer action ends the previous window, and what it held is sent then. Opening a session from the list, or showing another machine, ends it too. An action with no bar (the palette's Archive session, the strip's Restore) still has its window, so it ends the older one.
- Ctrl+Z or Cmd+Z undoes the newest action while its window is open, unless focus is in a text field.
- Focus never moves to the bar. Its polite live region is always there, empty while no bar shows, so its words are announced when it appears.
- The window's bar sits inside the visible area, above the soft keyboard, and while none shows it takes no taps.

Archiving the session being read keeps the page on it, read-only, with the existing "This session is archived · Restore" strip, which is its undo; that archive shows no bar. A session cleanup that archives the session being read keeps the page on it the same way; a cleanup that deletes it moves to the next session there is.

## Reach, other devices, reloads

- A machine known to be out of reach refuses the press at once: nothing moves, nothing is queued, and the app row says why. What counts depends on who does the work. Session work (archive, restore, delete, cleanup) needs the session daemon: a Machines list's answer of Error (a stopped daemon) or Offline from the last 15 seconds, or the announcements socket closed past the request deadline, refuses it. A list answers once per visit (r148; a check that got no answer in time is checked once more within it before it reads Offline, r156), so an older answer counts as not known, and a refusal checks the machine again so the next press is judged on a fresh answer. Project, package and workspace work needs the machine's web process: only a machine that does not answer at all refuses it. Removing a machine or a page's access is kept by the gateway serving the page and is never refused here. A machine not known either way is asked, and its answer decides.
- Other devices and a reloaded page show only what the machine did. A held action is not done until its window ends, so they still show the item meanwhile.

## Not covered yet

- The terminal plugin's tab close still waits for the machine. Holding it with Undo needs a plugin-facing Undo helper, which is a later decision.
