# Review triage: session transcript port (goal task 3)

Commit under review: 4f5a3933 (+ fixes below). Two glm max-thinking lanes,
split boundary/side-effects vs contract/tests.

| # | Lane finding | Adjudication | Action |
| --- | --- | --- | --- |
| P1-F1 | `listSessions` reused the browser's `list`, which reconciles: retires unread rows and activity for sessions absent from a listing, clears archive notifications - an unattended plugin scanning on a timer could permanently delete a badge during a transient read failure | TRUE | Fixed: `PiSessionService.listPassive` returns the same rows with no reconciliation; the port reads through it (test asserts `reconcileCwd` is never called) |
| P1-F2 | `readMessages` went through `getOrOpen`: every plugin read opened a full agent runtime that was never released; an indexing plugin would hold hundreds of runtimes | TRUE | Fixed: `PiSessionService.messagesPassive` pages an open session from its live entries and a closed one from its file via `readSessionEntries`, never creating a runtime (test asserts the runtime factory is not called) |
| P2-F3 | During shutdown drain a plugin could still open a runtime on the disposing service | TRUE | Fixed: the reader is cleared at `quiesceServer`, so reads refuse with the named error for the whole drain; the passive path opens nothing anyway |
| P2-F4 | The one-shot plugin health snapshot runs before the reader is set; a plugin probing the port in `health()` is recorded unhealthy for the daemon's lifetime | TRUE (pre-existing one-shot health) | Accepted with reason: the not-ready error is now a public constant (`SESSION_TRANSCRIPTS_NOT_READY`) documented as retry-later; plugins must not probe the port in `health()`. Re-inspecting health after startup is a separate seam decision |
| P2-F5 | An unsized `readMessages` returned the whole transcript | TRUE | Fixed: the port sizes every read (default 100, the paging cap applies) |
| P2 | cwd not normalized like the browser boundary (archived rows filtered by raw string) | TRUE | Fixed: `normalizeRequestCwd` at the port |
| P2 | "same projection as the browser" was one strip short (thinking signatures) | TRUE | Fixed: `projectBrowserMessageResponse` at the port |
| P2 | Not-ready error not nameable by plugins | TRUE | Fixed: exported from `server-plugin-api` |
| P2 | Paging semantics undocumented on the public contract | TRUE | Fixed: documented on `readMessages` |
| P2 | Wiring (reader assigned after construction; web gets no port) untested | TRUE | Partially: passive-read tests pin the service methods; the sessiond wiring stays integration-only (no unit harness for `createSessionDaemonRuntime`) - recorded as a known gap |
| — | Summary leaks browser-unshared data / scope without machine / frozen port | FALSE | verified by both lanes |

Live: daemon rebuilt and restarted on 8505, health OK.
