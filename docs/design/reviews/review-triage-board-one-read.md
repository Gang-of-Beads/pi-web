# Review triage: P4 slice a, the session board in one read

Review run `4de453b9` used two lanes on `reviewer`: Opus 5.5 and DeepSeek 4.1 flash max. Both returned **OK with notes** and found no P0 or P1. Each finding was checked against the source before triage.

| # | Finding | Lane | Verdict | Action |
|---|---|---|---|---|
| 1 | The route had no overall budget. Provider resolution has no deadline on the web side (the daemon allows 10 s per provider), and each listing has its own 25 s. A slow provider plus a stalled listing therefore passes the page's 30 s deadline, and a board that would have been partial becomes a whole miss. | O-1, D-F5 | **True.** Before this slice, each per-source read was bounded on its own. | **Fixed.** The route measures one 20 s budget from the moment it is asked. Any provider or listing that has not answered by then comes back as unknown (`beforeDeadline`). Test: a provider and a listing that never answer give a 200 board with both unknown. Mutants ML and MM are killed. |
| 2 | The app-shell leg ("an older web process answers the path with `index.html`") had no test through the real fetch path. A change to `readResponse` that wrapped the JSON parse failure would make every old remote retry forever, and no test would fail. | D-F1 | **True.** | **Fixed.** A controller test serves `/session-board` as `200 text/html` through the real `request()`. It checks that the board falls back source by source and is complete. Mutant MN (SyntaxError not counted as unsupported) is killed by it. |
| 3 | A gateway's `Machine not found` 404 also reads as "no board route" and is remembered until reload. | O-2 | **True, and harmless.** The fallback builds a correct board; it costs 1 + P + W requests per read until the page reloads. The same holds for a proxy's sign-in page. | **Documented** in `boardRouteVerdict`'s docstring. Telling the cases apart would mean a typed code on the gateway's 404, which is not worth it for a machine that is being added. |
| 4 | Object-model §1.5 named a wire module, `shared/sessionBoardAnswer.ts`, that does not exist. | D-F2 | **True.** The plan's shared module was dropped: each side types its own shape, and the client parses each entry with its existing parsers. | **Fixed.** The doc names `web/sessionBoardRoutes.ts` and `parseSessionBoardAnswer`. |
| 5 | §4.4 names `/api/sessions/board` with a head. §4.5 still credits the 2-lane cap with the board's listings. | D-F3 | **True.** | **Fixed.** §1.5 now says why the path is `/api/session-board`: an older web process answers it with 404 or the shell, instead of reading `board` as a session id. It also defers §4.4's head and per-project revisions. §4.5 now scopes the lanes to gap filling and to machines without the route. |
| 6 | The probe counted workspace reads but never asserted them, and it checked "every source answered" only inside the control leg. | D-F4 | **True.** | **Fixed.** "Every source answered" is now its own precondition. The one-read leg also requires at most one workspaces read on the page, which is the selected project's own. |
| 7 | The board and the workspaces controller can no longer share one in-flight GET for the selected project's resolution. | O hunt 4c | **True, negligible.** The page now makes one board read plus that project's own read, where before it made 1 + P + W. | No action. |
| 8 | If the client rejects a project's resolution, the server has still listed that project's workspaces, so their sessions show while the project is unknown. | O hunt 1 | **True in theory, not reachable.** The daemon catalog parser already enforces the project id and the shape. | No action. |

## Probe that had rotted

`probe-board-heals.mjs` leg B made one workspace's listing fail at the browser. Since this slice the browser does not read that listing, so its precondition failed loudly ("failed 0").

The probe had rotted, not the product. The partial board now comes from the web process, and the page fills the gap with its own read of that listing. Leg B now does both:
- it serves the real board answer with that workspace's listing marked unknown for 6 s;
- it loses the page's gap read for the same 6 s.

Result: 9/9. The gap healed at 5.7 s, and nothing else was read again.

Mutation: MA–MK on the first cut and ML–MN on the fixes are all killed.
