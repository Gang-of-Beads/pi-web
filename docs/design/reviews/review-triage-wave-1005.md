# Review triage: local wave of 2026-10-04/05

Workflow `db5fbe2b`: two split-focus lanes on `botim-bllm/deepseek-v4.1-flash:max` (connection and logs; navigation and UI) and one full pass on `anthropic-merchant/claude-opus-5:max` (dialogs, command trim, cross-cutting). Commits reviewed: afcc657f, 2b64a088, e773d1fc, 85834f92, d05374e8, b8ec59fe, 69f85d4a, 39cccc9c, 94faab00, 2ee72918, 833a0499, c0e7a54f. Every P1 below was re-read in the source before it was accepted.

## Fixed

Commits: e200bb3c (Settings, Back order, Go to, dead helpers, doc), b2d28542 (switcher order, match count, folded counts), 0f3eed3d (dialog options as text, per-dialog read, daemon command trim, docs), 76710c22 (socket phase listener, reachedServer), 9e90c0dc (log copies, last good settings, busy save, tree inset). Each was checked live on 8505 where the finding is reader-facing; see the commit messages.

| Finding | Lane | Verdict | Fix |
| --- | --- | --- | --- |
| Settings closed by the back gesture skips the plugin reload, and the stale flag reloads a later visit | navigation P1-1 | true: `onPopState` closes Settings through `restoreSettingsRoute`, which never consumed `reloadAfterSettings` | one Settings-left transition consumed by every close path |
| Back closes the cleanup dialog behind its open confirm, and the confirmed cleanup then does nothing | navigation P1-2 | true: `closeModalLayer` checked `sessionCleanupDialog` before plugin dialogs, which paint above every core dialog | plugin dialogs answer Back first, in paint order |
| The quick switcher's held row order never holds | navigation P1-3 | true: one `HeldRowOrder` was called once per section and each call overwrote the last order | the sheet orders all its rows once per render; sections filter that order |
| "No sessions match" shows beside a listed archived match | navigation P1-4 | true: `matchCount` excluded archived sessions the sheet now lists | count every listed match |
| A non-string select option reaches the wire and the client drops the whole status | full pass P1 | true: the store copied options unchecked; the client parser throws on a non-string, and `parseSessionStatus` is all-or-nothing | the store turns each option into text; the client drops only a dialog it cannot read |
| The command trim sits at one producer; the daemon forwards untrimmed text and reports done | full pass P1 | true: `sessionCommandService.run` names the command from trimmed text, then prompts with the untrimmed text | the daemon prompts with the trimmed text |
| An older client loses a machine's whole status for one dialog it cannot parse | full pass P2 | true, same path | covered by the per-dialog drop |
| `docs/plugins.html` still documents refused dialogs | full pass P2 | true | sentence replaced |
| `openDialogRecord`'s docstring names refusals that are gone | full pass P2 | true | docstring names the remaining refusal (an unknown kind from a newer pi) |
| A liveness drop changes the socket phase without telling its watcher | full pass P2 | true: `checkLiveness` never called `phaseListener` | it calls the listener |
| `reachedServer` survives a machine switch | full pass P2 | true: `connect()` never reset it | reset on connect |
| Back from Settings opened through Go to over the Navigate overlay costs a dead press | navigation P2-7 | true: the overlay stayed open under Settings | Go to's Settings line closes the overlay first, as the overlay's own Settings key does |
| A folded section shows no count | navigation P2-5 | true: only a section folded by default said its count | a folded section says its count |
| Lowering "Older copies kept" leaves higher copies on disk | logs P2 | true | rotation removes numbered copies beyond the setting |
| A malformed `logging` key silently reverts a running process to defaults | logs P2 | true | the process keeps its last good settings and logs one warning per change |
| A Logs save is dropped silently while another save runs | logs P2 | true (narrow) | the card says another save is in progress |
| The row covers the top band of the full-height session tree dialog | logs P2 | true: the tree sized itself `100dvh`, overflowing the inset backdrop | the tree's height subtracts the row inset |
| Copy-then-truncate loses lines written during the copy | logs P2 | true, inherent to copy-truncate | docstring says so |
| Dead `shouldShowAppRefresh*` helpers | navigation P2-9 | true | removed |
| `navigation-lists.md` still specifies the "you are here" mark | navigation P2-8 | true | doc updated |
| `closeSettings` claims every typed thing survives the reload | navigation P2-6, full pass P2 | true: composer attachments and a half-typed extension input are memory-only | docstring narrowed; reported to the owner |

## Not fixed, with reason

| Finding | Lane | Reason |
| --- | --- | --- |
| A daemon without the join frame is called "unavailable" for up to 20 s per page load | connection P1 | The join frame shipped on 2026-08-10 (f9cfce89); every daemon in the fleet, 8504 on v2.202609.28 included, sends it. A daemon that old also lacks the plugin lifecycle contract the gateway already requires. The window is bounded by the first keepalive. |
| Log retention is inert on systemd and on launchd with `PI_WEB_DATA_DIR` only in a login shell | logs P2 | systemd output goes to the journal by design (documented in config.md "Logs"); the launchd variant needs the service to carry `PI_WEB_DATA_DIR`, a service-installer change for its own wave. |
| Closing Settings after a plugin toggle drops composer attachments and a half-typed extension input | navigation P2-6, full pass P2 | The owner chose reload-on-close; persisting attachments is a separate design. Reported to the owner. |
| No unit tests for `sessionOrder`, `heldRowOrder`, `listFolds` | navigation P2-10 | Owner ruling 2026-10-03: no new unit tests. |
| `openWorkspaceFromQuickSwitcher` rethrows to a `void` caller | navigation minor | No wrong state; an unhandled rejection in the console only. |

## Judged not true

Every other hunt item was adjudicated FALSE by the lanes with file:line evidence; the lanes did not disagree on any item.
