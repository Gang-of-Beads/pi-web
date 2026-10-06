# Review triage: Go to scopes and global pages

Commits reviewed: `ddd27d0b`, `75b37d5e`, `dd22bd17`, `a9b9910d`. Workflow `64023061`: lane A server and
terminals (`botim-bllm/deepseek-v4.1-flash:max`), lane B scope and rendering (deepseek), lane C full pass
(`anthropic-merchant/claude-opus-5:max`). Lane A: block on F1; lanes B and C: OK with notes. Each item was
settled against the source.

## Fixed

| # | Lanes | Finding | Settled by | Fix |
| --- | --- | --- | --- | --- |
| 1 | A F1, B P1, C F1 | Machine terminals 404 on every remote machine: the gateway mounts only federated routes under `/api/machines/:id`, and `/terminals` was not federated. | `federatedRoutes.ts` lists only the project terminal family; `machineProxyRoutes.ts` registers exactly that table. The 8505 stack has no test remote, so it never showed. | `/terminals` (GET, POST, DELETE), `/terminals/:terminalId/continue`, `DELETE /terminals/:terminalId` and the socket are federated; the contract test lists the new client calls, which is the check that would have caught it. |
| 2 | A F2, C F2, B P3 | Updates' Run showed nothing until the command was typed (0.3-10 s) and nothing at all on failure; a failed type left a shell behind; with no global Terminal page the shell started off screen. | `runInNewTerminal` awaited `typeCommand` before `openGlobalTerminal`; the plugin only logs; `openGlobalTerminal` no-ops on an unresolved slot. | The page opens as soon as the shell exists; a failed type closes the shell and the app row says the command did not run; an unresolved slot says the global terminal is unavailable. |
| 3 | C F3 | `isGlobalPage` ignored the machine, so after a machine switch another machine's page id drove the URL, the desktop column and Go to's scope (Files rendered under it). | `getGlobalPanels()` spans every machine visited; registrations are not released on a switch. | `isGlobalPage` asks the machine-filtered resolver, as `visibleGlobalPanels` does. |
| 4 | A F3, B P2 | A chosen global page that is not `visible` (Updates before the status is read) fell into the project branch: "Select a project". | The panel got only the visible list. | The panel renders from the machine's global pages; `visible` decides only what Go to offers. The app bar's page name reads the same list. |
| 5 | B P2 | The workspace edge control read "Expand workspace panel" beside an open column showing a global page. | `workspacePanelOnScreen` and `shellClass` used different predicates. | One predicate, `workspaceColumnHasContent`, for both. |
| 6 | B P2 (pre-existing) | "Go to terminal" (mod+3, the palette, a command run's open) stored the slot alias as the tool, so the column showed Files and the app bar named nothing; the two `=== "core:workspace.terminal"` checks were dead. | `openWorkspaceTool` stored its argument verbatim; `shownWorkspacePanel` falls back to the first page. | `openWorkspaceTool` resolves the id at the door; the terminal checks compare with the resolved slot. |
| 7 | B P3 | The machine terminal socket route had no failure path. | Its sibling sends an error frame and closes. | Same handling. |
| 8 | C F4 | Global pages skipped the alias rules: no implicit source alias (a gateway link failed on a remote), no validation, no ambiguity guard. | `qualifyGlobalPanel` spread the contribution; the resolver took the first alias match. | `parseRouteAliases` as for project pages; two pages on one alias resolve to neither, with a warning. |
| 9 | C F5 | Go to from a Navigate page narrowed to project B, while B was still loading, listed project A's pages. | The page reported "project" without saying which. | The page reports the project id; Go to offers project pages only when the selected workspace belongs to it. |
| 10 | B note | The global Terminal's selected shell was not keyed by machine. | `selectedMachineTerminalId` was a bare id. | It carries its machine and is offered only on that machine. |
| 11 | C F6 | The design doc said Go to follows the switch on the desktop too, then reversed it. | `79cb2bc6` superseded it; the desktop Navigate page has no Go to key. | Placement section corrected. |

## Not fixed, with reason

| Lanes | Finding | Reason |
| --- | --- | --- |
| A note | Neither terminal route family binds a deadline. | Same as the existing workspace routes; a separate change for both. |
| B note | An action chosen from the palette over the Navigate overlay changes the page underneath. | Pre-existing, and the palette itself is on screen; not a swallowed Go to tap. |
| A note | The global page autostarts a shell whenever none exists in the home folder, unlike the project page's one-time autostart. | The friendlier rule for a page whose only content is a shell; documented at `scopeFolder`. |

## Not verified live

The remote-machine path (fix 1) needs a second machine; the 8505 stack's only remote is the production 8504
instance, which is off limits and runs a build without these routes.
