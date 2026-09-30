# Review triage: P2 slice b, part 1 (a link opens its session, or says why)

Review run d5f01fbe had two lanes on the reviewer shell, using the ponytail and bob lenses. Brief: `/tmp/p2b-review-task.md`.
- **Opus 5.5:** focused on lifecycle, scope, the URL and absence. Verdict: OK with notes.
- **DeepSeek 4.1 max:** a full pass, focused on the daemon, old-daemon detection, presentation, owner rules and ponytail. Verdict: block, on two P1s.

I checked every claim against the source before fixing it. I added the three findings that need a live stack to `scripts/probe-session-gone.mjs` as legs F, G and H, and ran them on the unfixed build first: 14/17, and F, G and H each failed as the reviewer described.

## Findings

| id | lane | finding | verdict | action |
|---|---|---|---|---|
| DS-P1a | DeepSeek | The locate route was not in `FEDERATED_HTTP_ROUTES`. On a remote machine the web process answered with its SPA page (200 HTML), the JSON parse failed as a link-down miss, and the target read "Loading this session…" forever | true: seen on the wire (the curl returned the HTML), and probe leg H read `["Loading this session…"]` after 6 locates | Route federated; the federated-route contract test observes `locateSession`. Leg H goes to 8504, which still runs the older daemon without the route, and expects "isn't in *workspace* on prod-8504" |
| DS-P1b | DeepSeek | Four phone checks asked only for `selectedSession`: `toggleShellPanel`, the context bar's `onTogglePanel`, `leaveNavigate`, and the navigate page's `returnable`. So the navigation page, opened from the gone message, could not return to it | true: leg F, returnable false | One predicate, `hasChatSubject()` (`placeSessionId !== undefined`), used in all four and in `displayMainView`. `handleWorkspaceChange`'s transition is left alone: a workspace change drops any target first |
| O-2 / DS-P2a | both | The session a place names was read from `selectedSession` alone in four producers: the URL writer (already fixed), `routeMatchesCurrentSelection` (Forward to a workspace-only URL matched the gone message and returned early), the popstate URL match, and `machineNavigationSnapshotFromState` (a machine round trip reopened the latest session) | true: leg G forward showed the message under `session=null` | One pure function, `placeSessionId(state)` in `sessionTarget.ts`, read by all four; tested, including the machine memory |
| O-1 / DS-P2b | both | `selectClientPendingStartSession` sets a new selection without dropping the target, so a late locate answer replaced the session the reader had just started | true | The invariant is enforced at the controller's write seam: any write that sets `selectedSession` drops the target. The integration test fails without it (mutation-checked) |
| O-3 | Opus | An unanswered locate never gave its reason. `unknown.miss` was never read, which contradicted the D8 row "the app row says why" | true | The published target carries `unansweredSince` (the first miss, not restarted by retries). `targetUnanswered` joins the projects and machines claims in `earliestUnanswered`, so the row speaks after its grace with the typed miss |
| DS-P2c | DeepSeek | The listing accepts an id prefix, but the locate matched only the whole id, so a prefix link to a session in a subdirectory or archive read as gone | true | `findSession` takes the whole id, else the one id it begins (the precedence of `resolveSessionFileInDir`); an ambiguous prefix finds nothing. An archived record is looked up by the found session's id. Gateway and service tests cover both |
| O-4 / DS | both | The `scanStoreSessionSummaries` docstring now sat above the new helper | true | Helpers moved below it, each with its own docstring |
| O-5 | Opus | `TARGET_BY_FACT.none` mapped to `asking`, which would ask again at once in a tight loop (unreachable today) | true | `none` maps to `unknown` with a link-down miss, so it goes through the retry delay |
| O-6 | Opus | An archived record whose file is gone opens as archived, then "Couldn't load this session." | true, pre-existing (the listing does the same) | Deferred to the open-session-gone case (slice b, part 2), which is waiting on the owner's answer |
| DS-P3a | DeepSeek | `unwrittenSession` duplicated the literal for a newly created session | true | One `freshClientSession(session, cwd)`, used by start and locate; the unwritten case takes `runtime.cwd` |
| DS-P3b | DeepSeek | The env dir was scanned twice when it is also the workspace's session dir | true | The near dirs are deduplicated |
| DS-P3c | DeepSeek | `wayBack` was decided from `role` | true | The words table states `answered`; refusal words are a table by fact |
| DS-P3d | DeepSeek | A retried open that rejected escaped as an unhandled rejection | true | The retry path reports through `reportError` (an error notice); tested |
| DS-P3e | DeepSeek | Loading has no in-panel way back | true, by design | Owner rules: no "Try now", nothing to press while loading. The exits are the phone's navigation key (now returnable, F) and the desktop list |
| DS-P3f | DeepSeek | object-model says a coded-less 404 is still matched by its text, but the target never is | true, but the doc spoke of `isSessionNotFoundError` | §1.6 now says a coded-less 404 from locate is unanswered, never gone |
| O hunt 7 | Opus | "Go to main's sessions" reads oddly for the main workspace | a question of wording, not a defect | It is in the owner's pending wording question |

## Verification

- **Tests:**
  - daemon: `findSession` (exact, unique prefix, ambiguous, project dir, env dir), `locate` (5, including archived by prefix and unwritten), the route (200, 404 with the code, 400 without cwd);
  - client: API (found, unsupported, code), federated contract, classifier (scope, place, unanswered), resolver (10), view (2), integration (4), machine memory.
  - Every mutant was killed: the named branch, the write-seam drop, the unsupported branch, archived, unwritten, own dir only, the project dir, prefix.
- **8505:**
  - probe `probe-session-gone.mjs`: 3/11 on the old build (it opened another session), 14/17 on the first pass (F, G and H failed), then the final result below;
  - the P1 heal probes still pass;
  - MCP on desktop at 1280: the gone message, the way back to a URL without the session, no target.
- **8505 final** (daemon restarted by the stack):
  - `probe-session-gone.mjs` 17/17, including H against 8504 (the older daemon answers the envelope, which reads "This session isn't in main on prod-8504.");
  - heal probes 9/9, 6/6, 10/10, 13/13, 8/8;
  - suite 5949 passed; knip and tsc clean.
- **Probe correction:** leg F first asserted the message was hidden while navigation was open. With a chat subject the phone opens navigation as an overlay, as it does over a session, so the message stays under it. The close control and the return are the signal, and the first pass had neither.

## Observed, pre-existing, not changed here

- Restoring a workspace-only URL (back or forward, reload) opens the latest session without writing it into the URL. Nothing is named there, so it is not B31. It goes to the navigation list (B31/B37 family).
