# PI WEB object model

Status: revised design, 2026-09-30, with the owner's decisions of the same day (§7). Applies every "accept" in `docs/design/reviews/review-triage-object-model.md`. Builds on `docs/design/state-diagram.md` (rules 1–7, D1–D8, B1–B49, with B48 under D5), `docs/design/sync-convergence.md` (heads, B28 board read, keepalive head) and `docs/design/state-sync-redesign.md` (one FIFO, facts not copies).

## Summary

1. Every shown network value is an entry in a keyed `ScopedResource` map: `(phase, fact, value+key+head, one shared flight)`. Phase is `syncing | live | reconnecting`; no `failed`. A fact (`signed-out | gone | forbidden`) comes only from a typed server answer.
2. Read answers, events and heads meet in one classifier, `readVerdict → apply | merge | drop`; events before the first read are buffered; a head is stored only with its payload.
3. `wake()` is always a heads compare. A full read happens only on a key change, a cleared fact, an epoch change or a moved head.
4. Frames reach owners through one static handler table (`HubRouter`), which the compiler enumerates. The server exposes change through `headSources` on the hub, plus a publish nudge from web writers through `shared/sessiondClient`.
5. Reconnecting is one app row, typed by cause, with a grace period, a minimum visible time, no expiry and no dismiss. It renders above dialogs.
6. Web→daemon forwards use deadline constants and `AbortSignal.timeout`. A reader's deadline never cancels shared daemon work.
7. Phases: **P1** resource and row on projects, machines and workspaces → **P2** session open off the chain (typed not-found, passive tail page) → **P3** daemon tail (measure, startup instrumentation, scan single-flight, watcher filter, then deadlines) → **P4** board read, daemon heads, batched boot read → **P5** router, web publish, plugins, delete `normalizeTransientError` → **P6** transcript tail seed → **P7** boot weight and drafts. `RequestScheduler` is re-measured after P4.

Evidence sources (the inventories and reviews of design run `7b4fe5b7`, kept as subagent artifacts, not in the repository; triage in `review-triage-object-model.md`), cited as:
- **[C]** client inventory (`inventory-client.md`); paths relative to `src/client/src/`.
- **[S]** server inventory (`inventory-server.md`).
- **[N]** network inventory (`inventory-network.md`); **[M]** measured, **[E]** estimated.

Anything that does not exist today is marked **new**. Where the inventories lack evidence, the text says so.

**Presentation (binding, owner 2026-09-30).** The one app-level row (`components/errorBanner.ts`, rendered by `PiWebApp.renderErrorBanner`, `PiWebApp.ts:4186`, `:4394`) shows one claim at a time: reconnecting for the machine in use, a definite failure, or a server's error reason. Syncing is never visible. The one exception is the first read of a transcript with nothing known, which shows "Loading this session…" (§1.7). There is no per-panel marker, no "Try now" and no skeleton. Known same-key data stays live and actionable. A panel with nothing known shows no empty-state text until a read has answered. Opening a session fails only for *deleted* or *archived*, and each is shown as itself.

**Intent acknowledgement is not sync state** (owner, Q2). The row spinner, "Opening…" after 1 s and the D8 progress line stay: they answer "did my tap register". "Still opening…" (`navigationIntent.ts:130-135`) and "Loading projects…" / "Loading workspaces…" (`PiWebApp.ts:3117-3137`) are deleted; after the grace period the app row speaks.

---

## 0. The one state machine every read surface uses (B48, replaces twelve)

In code this is `ReadPhase`. It is the D5 B48 draft made structural and applies per entry of a `ScopedResource` (§2.1).

```
            key rendered                                   answer for this key
[*] ──► syncing ──────────────────────────────────────────────► live
          ▲  │ no answer (network error, reader deadline, 5xx, 504, protocol 404, daemon restarting)
          │  ▼                                                   │ moved head / epoch change / fact cleared
          └─ reconnecting ◄──────────────────────────────────────┘  → syncing (full read)
             next try: backoff 1,2,4,8 s capped at T; wake() = heads compare
live ──► live : event applied through readVerdict
any  ──► fact : typed refusal (401, 403, {code:"session-not-found"}, archived from session data)
```

- `ReadPhase = "syncing" | "live" | "reconnecting"`. There is no `failed`.
- A **fact** is separate from the phase: `ReadFact = none | signed-out | gone(deleted|archived|project-removed) | forbidden`. A fact ends retrying for that key and is rendered as itself.
- A server that answers with an error (a 5xx on a live link) is not a network problem, and the row says so (owner, Q9). The row cause is `server-error(machineId, reason)` and shows the error's reason itself, for example "*hxd-work-mbp*: <reason>". It never says "Reconnecting". The read keeps retrying on the same schedule, with no Retry button, and it is not a `ReadFact`.
- `value` is either `{ known: true, key, head?, data, source }` or `{ known: false, key }`. Old-key values never render (I1).
- `T` is the existing quiet window setting (default 15 s), reused as the retry cap. There is no separate setting.

---

## 1. Object catalogue

Legend: **Key**; **Props**; **States**; **Owner** (client / server, process); **Head** (`{namespace, value}`, §2.5); **Events**; **Read**; **Cache**; **Retention**; **Presentation**.

### 1.1 Machine (roster + health)

- **Key**: `machineId`; the roster is global.
- **Props**: `Machine {id,name,kind,createdAt,updatedAt}`, `MachineHealth {ok,status,error?}`, `MachineRuntime {ok,checkedAt}` [S §2.9]; client `machines`, `selectedMachine`, `machineStatuses`, `machineRuntimes` [C row 1–2].
- **States**: roster `ReadPhase`. Before P1 slice 3 it was `machinesLoad: unloaded|loading|loaded|failed`, with a sticky `failed` and a redundant `isLoadingMachines`; now `machinesLoad` is `unloaded|loading|loaded`, derived from the roster entry, and `isLoadingMachines` is gone. Health per machine is `reachable | unreachable | unknown` (**new** as an enum).
- **Owner**: client `controllers/machineController.ts`; server web process, with the registry contributed by the machines plugin (`serverPluginRuntime.machineRegistry()`, `shared/plugins/serverPluginRuntime.ts:186` [S §2.9]).
- **Head**: **new** `machines` head source. The web writer nudges the daemon through `shared/sessiondClient` (§2.5, P5).
- **Events**: none today. **New**: `machines.changed` on the global scope, published by the daemon hub after a web nudge.
- **Read**: `GET /api/machines`, `/api/machines/:id/health|runtime`; part of the batched boot read (P4).
- **Cache**: memory only.
- **Retention**: kept on no answer; the phase goes to `reconnecting`. **Shipped (P1 slice 3)**:
  - `MachineController` reads the roster through a `ScopedResource` with one key. Its mirror is the one writer of the roster into the state. An answer selects the machine the reader asked for only while they still want it (a deep link while it is the current intent), and otherwise keeps the machine they are on, decided again after a remote health read that may have taken seconds. Machines this client adds or removes change the known roster at once and read it again, so an answer read before the change cannot undo it.
  - A lost read is never an error and never `failed`; `machinesLoad` is `unloaded | loading | loaded`, and `isLoadingMachines` is gone. The roster counts for the app row, because the web process in use serves it.
  - A remote deep link waits for the roster while it is still the reader's intent (`rosterAnswered`) instead of a five-try ladder.
  - The remote route ladder never exhausts while the route is current. It uses the shared backoff (1, 2, 4, 8 s, capped at 15 s), and "still unavailable" is gone. Its notice is raised again only when its words change, so a dismissed one stays dismissed.
- **Presentation**: the app row only, with cause `machine-unanswering(machineId)` for a remote machine.

### 1.2 Machine status projection (carries projects and workspaces)

- **Key**: `(machineId, epochId)`.
- **Props**: `MachineStatusSnapshot {epochId, revision, machine, projects, workspaces, unattributed, generatedAt}` (`machineStatus.ts:31-45` [S §2.8]).
- **States**: `ReadPhase`, plus D5 `current|behind|diverged|unknown` on the revision.
- **Owner**: daemon `MachineStatusService.publishIfChanged` (`daemon/status/machineStatusService.ts:116`); client `controllers/machineStatusController.ts:49` [C row 2].
- **Head**: `{namespace: epochId, value: revision}` (exists).
- **Events**: `machine.status`, plus the join frame on connect (`sessiond.ts:256`). This is the change channel for projects and workspaces (§1.3, §1.4). There is no `projects.changed` event and no persisted projects revision.
- **Read**: `GET /api/status` (cached projection).
- **Cache**: memory. Topology can be up to 15 s stale because of the attribution TTL (`workspaceAttribution.ts:48,95` [S §2.8]). **New**: invalidate on filtered `workspace.changed` as well.

### 1.3 Project

- **Key**: `(machineId, projectId)`. Today the value carries no machine, and the check happens at settle (`projectController.ts:42,51` [C row 3]).
- **Props**: `{id,name,path,createdAt}` (`shared/storage/projectStore.ts` [S §2.9]).
- **States**: `ReadPhase`. Today it is `ProjectsLoadState` with a sticky `failed`, by design (`appState.ts:168-177`, `projectController.ts:46-51`).
- **Owner**: client `controllers/projectController.ts`, which is the **only** writer. `locateAndApplySessionWorkspace` moves into P1 and writes through the resource. Server: `ProjectStore` (shared module, written by web).
- **Head**: the `machine.status` revision. After a web write (`web/app.ts:79,87`), web nudges the daemon through `shared/sessiondClient`, and the daemon republishes `machine.status`.
- **Read**: `GET /api/machines/:m/projects` (`api/clients.ts:224`); in the batched boot read (P4); critical deadline 3 s.
- **Cache**: memory. No persistent seed until a probe shows the projects read on the critical path (the server answers in <10 ms, context obs. 1).
- **Retention**: on a key change, the old list is not rendered and the new key is `syncing`, `known:false`. With no answer, the same-key list is kept, the phase is `reconnecting`, and a retry is scheduled. Today no retry is scheduled for a board route (`PiWebApp.ts:1279-1283`, `:1442-1445` [C §3b]). The phone board's "Couldn't read the projects on this machine." (`PiWebApp.ts:2701`, `AppNavigatePage.ts:255`) is deleted.
- **Presentation**: with nothing known, no text; the app row covers the wait.

### 1.4 Workspace

- **Key**: `(machineId, projectId, workspaceId)`; `workspaceId = sha1(projectId+providerKey)[0..12]` (`daemon/workspaces/workspaceProviderRegistry.ts:109` [S §2.9]).
- **Props**: `{id, projectId, path, label, isMain, provider{pluginId,capabilities,metadata}, removal{…}}`.
- **States**: `ReadPhase`. Today it is a boolean `isLoadingWorkspaces` with no failure state; a failure renders "No workspaces found" (`workspaceController.ts:64`, `PiWebApp.ts:3139-3143` [C row 4, §2.7]). **New**: a provider verdict per workspace, `resolved | degraded-folder | unknown`.
- **Owner**: client `controllers/workspaceController.ts` (sole writer after P1); server daemon `WorkspaceProviderRegistry`, single-flight per project (`workspaceProviderRegistry.ts:206-220`), plus a short verdict cache (P3).
- **Head**: the `machine.status` revision; the board read echoes a revision per project (P4).
- **Events**: `machine.status`. `workspace.changed` names a cwd (`workspaceWatcher.ts:45`) and is filtered and coalesced in P3.
- **Read**: `GET /api/machines/:m/projects/:id/workspaces` (`sessionDaemonWorkspaceCatalog.ts:65`, no deadline until P3); `statSync` per workspace on the web loop (`app.ts:139` [S §5.8]).
- **Cache**: memory `workspacesByProjectId`, which becomes entries keyed by `(machine, project)`.
- **Retention**: as in §1.3. **Shipped (P1 slice 2)**: `WorkspaceController` reads each `(machine, project)` listing through a `ScopedResource`.
  - **Following**: the followed key is derived from the selection on every selection change, whoever wrote it (`PiWebApp.setState` calls `selectionChanged`). The shown project's lost reads retry, and a project left behind, including by a machine switch, stops being read.
  - **One writer**: a private mirror is the only place a listing reaches the state. It keeps known rows through a lost read or a refusal, ends loading on any value, and shows a refusal as a notice in its own words.
  - **`selectProject`**: opens the preferred workspace when the answer lands, unless the reader has moved on (another project, another machine, or a workspace chosen meanwhile). It resolves whether it landed, so a route restore stops when the reader has moved on.
  - **Locating a session**: `locateAndApplySessionWorkspace` reads through the projects and workspaces resources (`whenAnswered`, §2.1). It asks every project at once, so a project that never answers cannot hide the owner.

### 1.5 Session list / board

- **Key**: `machineId` for the board; `(machineId, workspacePath)` for the per-workspace list until P4.
- **Props**: `SessionInfo[]` plus **new** `lastActivityAt`, and **new** per-source `listed | unknown` (B8: a source is never dropped).
- **States**: `ReadPhase`. Today it is `SessionsLoadState`, where a failure resets to `unloaded` (`workspaceController.ts:89`), with a retry of 3 s×n that stops after 4 (`sessionController.ts:1114-1127` [C row 5]).
- **Owner**: client **new** `controllers/sessionBoard.ts` (today 17+ writers across 4 modules [C §2.5]); server daemon `PiSessionService.list` over `SessionSummaryScanner`.
- **Head**: board `{namespace: daemonInstanceId, value: revision}`, with per-project revisions echoed so that a moved head re-reads only what moved. Today: per-workspace `payloadRevision` (`payloadRevision.ts:8`, `sessionController.ts:1068-1076`).
- **Events**: `session.created`, `session.name` (`sessionController.ts:274-275`); `status.update`/`activity.update` for badges. Silent today: archive/restore/delete (`piSessionService.ts:3985,4000,4133,4225` [S §4.5]) and foreign session files [S §2.1]. **New**: `session.archived|deleted|restored`; `lastActivityAt` on every global `status.update`.
- **Ordering**: sorted by `lastActivityAt`. Rows re-sort live, but positions hold while a touch or scroll is in flight and settle when it ends (owner, Q7). Heartbeats arrive every 2 s per working session [S §2.2].
- **Read**: today `GET /api/sessions?cwd=` does a whole-store scan per request with no single-flight; 22 concurrent identical scans were observed at 10.7–11.0 s (`piSessionManagerGateway.ts:85-100`, `sessionSummaryScanner.ts:516` [S §3, §5.2]); p50 600 ms, p99 23 s [N §4]. The read also writes (`piSessionService.ts:1726-1744` [S §4.4]). **New**: `GET /api/sessions/board` (§4.5).
- **Cache**: memory `workspaceSessionsCache` (`workspaceSessionsCache.ts:17-19` [C row 6], deleted in P4); `cachedNewSessions.ts` in localStorage [C row 15]. No persistent board seed until measured.
- **Retention**: on a key change, old rows are not rendered. With no answer, rows are kept and the phase is `reconnecting`, with no retry limit. **Shipped (P1 slice 5)**, ahead of the P4 board read:
  - `SessionBoardController` reads the machine-wide board through a `ScopedResource<machineId, SessionBoard>`.
  - The read composes the listings and keeps a source that did not answer as unknown. A board with unknown sources is a partial answer: it renders its rows and is read again on the shared backoff while it is watched, with no miss for the row. A retry of a partial board asks only its unknown sources (`completeSessionBoard`), because each sessions listing is a whole-store scan on the daemon. A whole read happens when the reader forces one (after an archive, restore or delete), when the selected machine's project set changes, or when the board is more than 30 s old; a browse during a read in flight joins it (`ScopedResource.join`). A source that states a refusal (401, 403) makes the board read a fact, which ends its retries; the refusal's words come from the workspaces controller when a project is opened.
  - The quick switcher and the navigation board claim emptiness only for a complete answer (`BoardAnswer`, state-diagram B48).
  - **Shipped (P4 slice a): one read.** `GET /api/session-board` (`web/sessionBoardRoutes.ts`; the client parses it in `api/parsers.ts`, `parseSessionBoardAnswer`) answers every project's workspace resolution and every workspace's listing, each `listed` or `unknown`, composed in the web process, which owns the projects and the workspaces' `effectiveConfig`. It asks the daemon for the listings at once, so the scanner's single flight merges their store scans. The client builds the same `SessionBoard` from it (`boardFromAnswer`). A gap is still filled by the per-source reads (`completeSessionBoard`), and a machine without the route (404, or the app shell from an older web process) falls back to them whole (`boardRouteVerdict`). The route waits for its sources for at most 20 s and answers what has not answered by then as unknown, so a slow provider or listing leaves a partial board rather than a miss at the page's 30 s deadline. It is `/api/session-board`, not §4.4's `/api/sessions/board`, so an older web process answers its path with 404 or the app shell instead of reading `board` as a session id. Still to do (§4.4): the daemon-side board with one scan and an idempotent reconcile, and the board head with per-project revisions.
- **Presentation**: a source that has not answered stays as a row group, with no marker, and retries in the background (owner, Q3). The app row speaks only for the machine the reader is using. Another machine that stopped answering, or one project or workspace that did not answer, retries silently. The owner's example: working in the MacBook's sessions while the Ubuntu machine is down shows nothing.

### 1.6 Session (runtime identity), activity and status

- **Key**: `(machineId, cwd, sessionId)`. Server `PiSessionRef {id,cwd}` (`piSessionService.ts:455`). Client maps are keyed by id only (`appState.ts:116-118` [C row 10]) and become resource entries keyed by the full key.
- **Props**: status (`SessionStatus` incl. `pendingAsk`, `pendingDialogs`, `streamPosition`, queue); activity `{phase, label, detail?, at}` (`piSessionService.ts:1320`); **new** `lastActivityAt`, `backgroundWork` (D3).
- **States**:
  - Lifecycle, **new** as one server enum: `opening | active | closing | archived | deleted | not-open`. Today it is implicit across `active/startupSessions/archivedRuntimes/closingSessions` + `pendingSessionOpens` [S §2.1].
  - Activity: D3 via `sessionActivityCategory`.
  - Read: `ReadPhase`. Today `statusReadFailed` is terminal (`sessionController.ts:399`) and a catalog failure is swallowed (`:1195-1197`).
- **Owner**: client `sessionController.ts` (≈10 writers of status/pendingAsk [C §2.5]); server daemon `PiSessionService`.
- **Head**: `streamPosition {epoch, seq}` (exists).
- **Not found (P2 precondition, daemon restart)**: the daemon answers `{code:"session-not-found"}` from a typed error, and every other failure is a 5xx. Archived comes from session data. `HttpError` carries `code`; `classify` keys on the code first, then on the status; a protocol 404 (no code) is `no-answer`.
  - **Shipped (P2 slice a)**:
    - `daemon/sessions/sessionErrors.ts`: `SessionNotFoundError` (with `code: "session-not-found"`) is thrown wherever the daemon found no session. Its message text is unchanged, so older clients keep working.
    - A session route answers 404 with the code for it, and keeps its own status for any other failure: 500 for the transcript, status and model reads (before, every read failure there was a 404), 503 for the child-work reads (subsessions, subagent runs, background tasks), 400 for mutations and the notification read. A 503 from the local machine is a server error to the client, not a machine that did not answer: that needs the gateway's word (§2.3).
    - A session directory the daemon could not read is a failure, not an empty directory; only one that does not exist lists no sessions.
    - The client parses `code` into `HttpError.code`, and `classifyReadError` maps it to the fact `gone`.
    - The client's session-not-found check keys on the code. It keeps the old text match only for a coded-less 404, for a remote machine on an older daemon; the one-release fallback is to be removed after a release has shipped this.
    - The presentation of `gone` (the reason and a way back, owner Q8) is P2 slice b.
  - **Shipped (P2 slice b, a link's target; daemon restart)**:
    - `GET /sessions/:id/locate?cwd` answers where a session is, machine-wide, and whether it is archived: the asking workspace's own session directory, the env-configured one, then every directory of the default store (memoised summaries), then the open sessions not yet written to disk. It answers 404 with the code when none holds it. A read by the workspace's cwd cannot answer this: it sees only that exact cwd's session directory, while the workspace listing covers the whole tree.
    - Client: `sessionTarget.ts` classifies a named session (`SessionTarget`: open, archived, folder-gone, asking, unknown, gone, not-listed, refused); `controllers/sessionTargetResolver.ts` carries it to an answer, retries an unanswered locate on the read ladder, and is the only writer of `AppState.sessionTarget`, which carries its machine, workspace and cwd; `sessionTargetView.ts` is its words. The fallback to the latest session applies only when no session was named.
    - An older daemon answers the locate route with Fastify's not-found envelope; for one release the answered listing is then the evidence ("isn't in *workspace*").
    - The route is federated (`shared/federatedRoutes.ts`), so a remote machine answers it too; unfederated, the web process answered its SPA page and the target stayed "Loading" forever.
    - A locate matches the whole id, else the one id it begins (the precedence `resolveSessionFileInDir` uses), so a prefix link the listing accepts is not called gone.
    - A locate that went unanswered is a claim for the app row (`targetUnanswered`), dated from its first miss, so the row says why after its grace. A coded-less 404 from it is unanswered, never gone.
    - "The session this place names" is one value, `placeSessionId` (the selected session, else the target in scope): the URL, the popstate match, the route restore's early return and the machine memory all read it, and on the phone every "is there a chat behind this page" check asks `hasChatSubject`.
- **Events**: `status.update`, `activity.update`, `activity.changed`, `session.startup|stopped|error` [S §2.1]. Silent: inbox pushes between heartbeats (2 s, `publishHeartbeats`, `piSessionService.ts:5529`).
- **Read**: `GET /sessions/:id/status` (opens the session if cold, O(branch) [S §2.6, §5.3]); `GET /sessions/statuses` (in the batched boot read).
- **Cache**: memory, seeded synchronously on select from the catalog map (`sessionController.ts:401-409`).
- **Arbitration**: `readVerdict` (§2.1), taken from `statusOrder.statusReadVerdict`.

### 1.7 Transcript window

- **Key**: `(machineId, sessionId)` (`machineSessionKey`, `sessionController.ts:1809-1811`); server `(sessionId, cwd)`.
- **Props**: `ChatLine[]`, `messagePageStart/End/Total`, `newerPendingCount`; server `ClientMessagePage` + `TranscriptHead {n, leaf}` (`apiTypes.ts:1466`).
- **States**: `ReadPhase` + D5 + D4 viewport. Today it is `isLoadingTranscript` + `transcriptFailed` (terminal, `sessionController.ts:509`, `477-481`), with `transcriptLoadingOwnership.ts`.
- **Owner**: client `sessionController.ts` + `chatTranscriptStore.ts`; server daemon `PiSessionService` (`messages`, `messagesPassive`, `transcriptTail`).
- **Head**: `{epoch, seq, n, leaf}`. `{n, leaf}` is the identity check only: an `assistant.delta` grows an entry in place without moving `{n, leaf}` (`shared/branchMessages.ts:134-142`, `transcriptHead` in `piSessionService.ts`). A seed is confirmed only when the stream position `{epoch, seq}` is current.
- **Events**: `message.append|end`, `assistant.delta`, `tool.*`, `shell.*`. Silent: foreign and child appends [S §2.5].
- **Shipped (P2 slice c, daemon restart)**:
  - `GET /sessions/:id/transcript-tail?cwd&limit` (federated) answers `{page, stream}`. An open runtime answers from memory in one tick. A closed session's file is read on the branch the SDK would load (`fileBranch.ts`: the last entry, then its parents), with the stream position taken first. An unresolved file takes the runtime path.
  - The client's refresh starts `status` and the tail together. The transcript applies, and stops loading, when the tail lands; the status applies when it lands. A status failure sets `statusReadFailed` and no longer calls the transcript failed. A daemon without the route gets the old `messages` + `stream-snapshot` reads.
  - `messagesPassive` (the plugin transcript port) paged every file entry, abandoned branches included; it now migrates the parsed entries in memory with the SDK's own `migrateSessionEntries` and pages the branch.
  - The tail reads a file only when its header says the current version (`isCurrentVersionFile`): the runtime rewrites an older file in place when it opens it, so a read beside that open could see it half written. An open runtime is found with `activeForRef` (its cwd, and the start of its id), like every other runtime read.
  - A status read that fails keeps the transcript, sets `statusReadFailed` and raises the app notice with the server's reason; any status for the selected session clears the flag.
  - **Measured on 8505**, daemon-cold, 17.8 MB, phone. First transcript row at 2.68 / 3.12 / 4.42 s before, always after the status; 2.03 / 2.08 / 2.11 s after, always before the status. The tail answers in 0.107 s alone and 0.69 s beside the cold open.
  - **The budget (≤1.5 s) is not met yet.** The route restore waits about 1.1 s for the browser plugin modules, whose asset route asks the busy daemon for its plugin runtime on every request. That is the next slice.
- **Read (P2)**: the first tail page comes from `messagesPassive`, which reads the file, returns `head` and never creates a runtime. The runtime opens in parallel for `status`. Transcript and status each become `live` independently; there is no `Promise.all(messages, status, streamSnapshot)` gate and no serial `streamSync`→`status` (`sessionController.ts:1688-1750` [C §3a.3]). Today: p99 10.7 s on 8504; 1.55 s TTFB daemon-cold on 17.8 MB [N §2].
- **Cache**: memory LRU 12, span cap 400 (`chatTranscriptStore.ts:26,33`), looked up synchronously first. Today there is also localStorage `pi-web:chat-history:v2:` (TTL 7 d, ≤512 KB/entry, sync parse, `chatHistoryCache.ts:1,10,22,115-135`). **New (P6)**: an IndexedDB tail seed (last N rows + head, written together, writes debounced during streaming) replaces the localStorage path. It is never replayed from a persisted watermark.
- **Retention**: a same-key memory seed renders in the select frame. An IndexedDB seed takes one async hop; the previous key's pixels stay until the next key's seed or read resolves, and they are not actionable meanwhile (I1). Seed → read is executed by D4 `bottomAnchorAction`.
- **Presentation** (owner, Q3 of the ask): with nothing known and the first read in flight, the transcript shows "Loading this session…", the one visible syncing text. It never shows "Start the conversation" before a read answered (`ChatView.ts:1810-1818`). While reconnecting it shows no text, and the app row speaks.

### 1.8 Stream (per-session event sequence)

- **Key**: `(machineId, sessionId, epoch)`.
- **Props**: `seq`, `epoch` (`sessionEventHub.ts:226`), replay ring 256 frames, LRU 256 sessions (`:51-53,364`) [S §2.4].
- **States**: server `replayDecision` (`:404`); client D5 via `sessionGapRepair.ts`, `revisionScope.ts`.
- **Owner**: daemon `daemon/realtime/sessionEventHub.ts`; client `sessionGapRepair.ts`.
- **Head**: `{seq, epoch}` on the keepalive and in `status.streamPosition`. `seq` advances on every publish, even with no listener.
- **Read**: `GET /sessions/:id/stream-snapshot?sinceSeq&epoch`, which is no longer on the open path (the socket subscribes with `sinceSeq` from the reply).
- **Cache**: the watermark `pi-web:chat-watermark:v1:` is retired as a replay basis and deleted in P6.
- **Retention**: an epoch change means diverged, followed by a tail reload.

### 1.9 Socket (realtime hub connection)

- **Key**: `(machineId, scope: global | sessionId)`.
- **Props**: readyState, last frame time, cadence `min(20 s, max(3 s, 0.6·quietMs))` (`sessionEventHub.ts:39`), `KEEPALIVE_INTERVAL_MS = 20_000`.
- **States**: D5 `connecting|open|closed|dead`; `socketLiveness.ts:3` verdict. Client 5 s liveness timer, skipped when hidden (`PiWebApp.ts:1111,1291`).
- **Owner**: client `socketLiveness.ts` + socket code; daemon `SessionEventHub`; web `web/webSocketBridge.ts`.
- **Backpressure**: the hub terminates a socket with >1 MiB buffered and logs nothing (`sessionEventHub.ts:334-348`); the bridge queues without a cap while CONNECTING (`webSocketBridge.ts:14-31`) [S §4.6]. **New**: one logged counter per drop reason.
- **Presentation**: `dead` or backoff produces the row cause `link-down`.

### 1.10 Message (D1)

- **Key**: `(machineId, sessionId, clientMessageId)`; committed rows by `entryId`.
- **States**: D1 in full. The browser owns `sending|unverifiable|notSent`; the daemon owns the rest.
- **Owner**: client `pendingOutbox.ts` (`advancePendingPrompt`, `:64`) + `sessionController.ts:2224-2296`; daemon `OwnedPromptQueue`, `operationLedger.ts` (`:141`).
- **Head**: the inbox `seq`.
- **Events**: `prompt.accepted|withdrawn|refused` today; `prompt.handed|returned|committed|consumed` **new** per D1 (whether these have landed is not established).
- **Read**: `POST /sessions/:id/operations` (lost-answer probe, `sessionRoutes.ts:155`).
- **Routing**: a `HubRouter` handler calls the D1 reducer directly; the outbox is not a resource.

### 1.11 Outbox

- **Key**: `sessionKey` = machine + session (`pendingOutbox.ts:57-59`).
- **Props**: `PendingPrompt {clientMessageId,text,attachments,delivery,at}`; stored in localStorage, durable.
- **While reconnecting**: sends are enqueued (owner decision 2). Only `notSent` from this device younger than 10 min is resent automatically (D1). `VERIFY_AFTER_MS` (`sessionController.ts:2224-2235`).
- **Other actions while reconnecting** (owner, Q4): they fire now under the mutation deadline and the control shows as pending. They are never queued for replay. With no answer, a notice says the outcome is unknown, and the operations ledger probe re-checks it. That notice is a definite claim, so it takes the row as in §2.3.

### 1.12 Docked card (D2)

- **Key**: `(machineId, sessionId, askId|dialogId)`.
- **States**: D2 `open|answered|cancelled|refused`, with typed cancel causes.
- **Owner**: daemon `PendingAskStore` (`pendingAskStore.ts:84`), `PendingExtensionDialogStore` (`:83`); client card store via `RevisionScope` (`sessionController.ts:216-223`). A router handler calls the card store.
- **Head**: `dialogRevisionBySession` (`piSessionService.ts:1439`), namespaced by `daemonInstanceId`.
- **Retention**: a missed revision triggers a resync (`sessionController.ts:223`).

### 1.13 Unread / notification

- **Key**: unread `(machineId, sessionId, cwd)` + `catalogId`; notification `(sessionId, daemonInstanceId)`.
- **Owner**: client `SessionUnreadController` per machine (`sessionUnread.ts:87`); daemon `sessionUnreadStore.ts`, `sessionNotificationStore.ts` (`:86-95`).
- **Head**: `unread` head source, `{namespace: daemonInstanceId, value: catalogRevision}`.
- **Events**: `session.unread`, notification inbox/summary.
- **Read**: today `GET /sessions/unread` awaits `flush()` (`piSessionService.ts:1561`); this is the most frequent slow path, 299 >4 s [S §5.6]; remote unread p90 10.5 s [N §4]. **New (P3)**: it returns the memory snapshot without awaiting flush.
- **Reconcile owner**: the board read keeps an idempotent unread reconcile and the archive-notification clear, with no flush (P4). Until P4 they stay in `list` (P3 removes only the flush).
- **Resume**: `refreshAll` on resume (`PiWebApp.ts:1318`) becomes a heads compare.

### 1.14 Pins

- **Key**: projects global (`projectPins.ts:12`); sessions per machine (`sessionPins.ts:18,45`); server `shared/storage/sessionPinStore.ts`, route `web/sessionPinRoutes.ts`.
- **Head/events**: since P5 slice a, `pins.changed` on the machine's realtime socket: the web pin route nudges its daemon (`shared/sessiondClient/changeNudge.ts`, daemon `realtime/changeNudgeRoutes.ts`). The pins head for the quiet window *T* comes with the heads work (B28).
- **Read**: `GET /api/session-pins`. Before P5 slice a, re-read on render when older than 2 s → 30/min on 8504 [N §3, §4]. Since: once per machine, then on `pins.changed`, on that machine's socket reopening, and on tab resume; a render never reads. A remote machine's pins go through the gateway (`FEDERATED_HTTP_ROUTES`, P5 slice b; before, they had never been readable there). **Still to do**: the batched boot read and the pins head (B28).
- **Pins outlive projects (B49, owner Q10/Q11).** A pin names a session; it is global per machine and does not depend on which projects are open. A project exists to create new sessions in its directory and to open its own session list, nothing more. So the global PINNED group is resolved by the daemon from the pinned ids (the board read carries the pinned sessions whatever projects are open), and tapping a pinned session opens it without reopening its project. Closing a project says nothing about its pins. Until B49 slice a the row vanished silently, because PINNED was built from the open projects' lists (verified on 8505). **Shipped (B49 slice a):** the board answer (P4 slice a) carries `pinned`: each pinned id that no answered listing holds is located on the daemon (`/sessions/:id/locate`, a store-wide scan the scanner memoises) within the board's budget, and answered as the session, `gone` (the typed not-found code) or `unknown`. The page lists the found ones in PINNED beside the open projects' pinned rows (`SessionBoard.pinnedElsewhere`) and in the quick switcher, and its row menu acts on them on their own machine. A gone pin is not drawn; what it should say is the owner's (asked). An unknown pin keeps the board partial (`UnknownSource` `pin`), so it is located again (`completeSessionBoard`, the daemon's machine-wide locate) rather than left out silently. Tapping one opens the session; its project stays closed. The place is typed (`locateSessionWorkspace` → `found | outside | unknown`): a session outside every open project leaves the project and workspace selection empty, so neither the page nor the URL goes on naming the project the reader was in, and the URL names the session alone. A route naming a session with no project opens it through the named-target machinery (`openSessionAlone`, D8), so a reload lands on it, or says it is gone. A machine without the board route, or a pin store that cannot be read, gives no `pinned`, and PINNED is the open projects' pinned rows as before.
- **Two kinds of pin** (owner, 2026-09-30, asked after Q11: "should global pins and project pins be separate?", answered "two pins"):
  - **Global pin**: machine-wide. It is listed in the global board's PINNED, whatever projects are open. It is today's pin, stored in `session-pins.json`.
  - **Project pin**: kept at the top of its own project's session list. **New**. It is stored per machine and per project, next to the global pins, so every device sees it.
  - The row menu offers "Pin globally" and "Pin in this project" as two separate toggles, and a session may carry both.
  - Still to design, before code: whether global pins also show inside a project's list. The owner once reported a global pin "vanishing" inside a project, so the answer must be explicit.

### 1.15 Background runs, subagent runs, interrupted runs

- **Background tasks**: keyed by the selected chat; `BackgroundTasksRead` (`backgroundTaskRows.ts:13`), cleared after a frame (`PiWebApp.ts:754-761`). Read `GET /sessions/:id/background-tasks`. **New**: the `backgroundWork` count on status is the head.
- **Subagent runs**: key `sessionFile`; before P3b `setInterval(runs.tick, 3000)` from render, forever. Since P3b the poll runs only while the panel or its badge is drawn and the session works, with a read on each edge (state-diagram D5, "The subagents run list"; `subagents/runsPolling.ts`); `runs.list` 1,747 calls, p90 2 s [N §4]. **New**: a resource plus the generic `plugin.changed`; no `runs.changed` special case.
- **Interrupted runs**: `GET /sessions/interrupted` is read-and-clear (`sessionRoutes.ts:118`). Its spec declares `effect: "read-and-clear"`: there is no client retry of a spent record; a lost answer is re-asked only through the ledger probe. It is included in the batched boot read with the same effect.

### 1.16 Plugin (D6) and plugin panel

- **Plugin key**: `(machineId, pluginId, process)`; catalog `revision` (`piWebPluginCatalog.ts:34`); runtime `active|failed|incompatible|disabled`.
- **Panel key**: `(pluginId, machineId, projectId, workspaceId[, sessionId])`.
- **Panel data today**: git polls every 8 s while on screen (`git-panel.ts`, `GIT_POLL_INTERVAL_MS`), terminal command-runs every 1 s (`TerminalPanel.ts:288`), goals use a single slot with a terminal `failed` (`goals/pi-web-plugin.ts:71-90`), tasks use `configCache` [C rows 25–29].
- **Server**: operations run with no timeout and no cap (`serverPluginRuntime.ts:202`); `plugin-backends` re-resolves the provider on every call and calls `onWorkspacesMutated()` (`workspaceProviderRegistry.ts:379-500`, `pluginBackendRoutes.ts:99`) [S §4.4].
- **New**:
  - Plugins get `host.resource(spec)`. The server half emits `plugin.changed {pluginId, scope, revision}` through the host.
  - Every open panel keeps a head and verifies it every *T* (4 reads a minute per open panel), which covers workspaces without a watcher.
  - A repo test forbids `setInterval` in first-party plugin browser code; voice is on the allowlist.
  - Third-party plugins: a deprecation warning for one release, then removal. This is an engineering call; the API cannot enforce it in the browser.
- **Watcher (P3), after the owner's requested research** (run 8f558e71; VS Code's git extension, GitLens, lazygit, GitHub Desktop, JetBrains):
  - **Cause.** The watcher is a recursive `fs.watch` on the whole workspace with no filter (`workspaceWatcher.ts:39`). It publishes `workspace.changed` at most once per 250 ms burst (`:44`, `:92-99`). Every `.git/objects` write, every `index.lock`, `node_modules`, and the `.pi/tasks/*.output` logs that background tasks append continuously therefore become one git status plus one tree read up to 4 times a second, which is the storm [N §4].
  - Our own `git status` already runs with `--no-optional-locks` (`git/server-plugin.ts:195-201`), so our reads do not rewrite the index.
  - **What the mature tools do.** Shipped in the watcher change (`workspaceChangeFilter.ts`, probe `probe-watch-noise.mjs`):
    - **A `.git` whitelist:** `HEAD`, `index`, `packed-refs`, `config`, `shallow`, `refs/**`, `*_HEAD`, `MERGE_*`, `rebase-*/**`, `sequencer/**`, `info/exclude` (the GitLens set). A terminal commit shows through `index` and `refs/**`, which is why `.git` is not ignored wholesale. A linked worktree's state under `.git/worktrees/` is not news for the main workspace.
    - **Always dropped:** `*.lock`, `objects/**`, `logs/**` and every other `.git` file; `node_modules` at any depth; the git directory of a nested clone; `.watchman-cookie-*`; `fsmonitor--daemon/`; pi's runtime logs (`.pi/tasks/`, `.pi/delegate/`).
    - **The working tree is news, build output included** (`dist/`, `.next/`, `target/`). The tree and git panels show it, and a busy build publishes at most once per 2.5 s window. Checking `.gitignore` would cost a git spawn per event; add it only if a measurement shows build output on the budget.
    - **Two trailing windows:** 250 ms for git state (a commit shows fast) and 2.5 s for the tree (GitLens's numbers). A git-state change brings a pending tree publish forward.
    - **Visibility gating:** a hidden tab only remembers which workspace changed (machine and path), and refreshes it once when the tab is shown again, if it is still the one on screen.
  - **Still to do (P3, after measuring):**
    - one status in flight plus one queued per workspace (VS Code's throttle);
    - our own git operations marking the workspace busy and merging the events they cause;
    - status cached by (HEAD, index mtime, tree generation);
    - the 10 000-entry cap;
    - the Git panel's own 8 s poll (`git-panel.ts:40`): since P5 slice c it runs only while the panel is on screen and the tab is visible; ending it needs a watch for the workspace on screen, not only for the open sessions' directories.
  - **Budget:** ≤ 8 git/tree reads a minute with the panel open and nothing changing, and a terminal commit visible within about 1 s.

### 1.17 Goal (D7)

- **Key**: `(machineId, projectId, goalId)`; focus `goalId → sessionId`.
- **States**: D7. Reads use `ReadPhase`; "unreadable" is a fact (B27), never "no goals".
- **Today**: `readKey(workspacePath, sessionCwd)`, one slot, `failed` terminal (`goals/pi-web-plugin.ts:56,68-90`). **New**: `host.resource` + `plugin.changed`.

### 1.18 Navigation intent (D8)

- **Key**: counter `seq`; target `(machine, project, workspace, session, view)`.
- **States**: D8 `restoring|at|going`. Today the phase is `going|slow|stalled|failed` (`navigationIntent.ts`).
- **Change (owner decision 6)**: `failed` and "Couldn't open · retry" are removed. The outcomes are `at`, `gone(deleted|archived)` (from the typed fact, §1.6), or `going` continuing while the read reconnects. The route-restore ladder (1/3/8/15/30 s, `PiWebApp.ts:261,1669-1677`) is deleted. `stalled` wording is deleted (Q2).
- **Archived by link** (owner, Q8 of the ask): a read-only transcript, the "Archived" reason and Restore. Deleted shows "This session was deleted" and a way back to the board. `archivedRuntimes` keeps archived transcripts readable.
- **Critical path**: the app writes `cwd` into every session link it makes. A route with `cwd` starts the session reads immediately (+0.55–1.5 s saved [N §2]; `PiWebApp.ts:1253-1432`, `workspaceController.ts:57,78`). Without `cwd`, it falls back to the project → workspace → session chain.

### 1.19 Terminal

- **Key**: `(machineId, terminalId)`, `cwd`. Events `terminal.created|exited|closed|output` [S §2.11]. **New**: `terminal.commandRun` events replace the 1 s poll (`terminalService.ts:43` already owns `commandRuns`).

### 1.20 Local-only objects

| Object | Key today | Defect | Change |
|---|---|---|---|
| Prompt / ask drafts | sessionId only (`promptDraftStorage.ts:1-4`, `askDrafts.ts:16-20`) | no machine in the key | **new** key `machine:session[:ask]`. Lazy adoption: when X opens on M and a legacy key X exists, it is adopted as `M:X`. Drafts are never dropped (engineering call, not asked) |
| Route/selection memories | per machine+project, sessionStorage | — | unchanged |
| UI preferences | per module localStorage | — | adds *T* |
| Quick switcher | own loading/error, 30 s staleness (`PiWebApp.ts:452-454,531-539,2866-2908`) | fourth copy of the list read | reads the board resource (P4) |
| Settings / fleet dialogs | 5 loading+error pairs (`SettingsDialog.ts:71-82`), fleet (`PiWebApp.ts:547-549`) | terminal errors | one resource per section |
| Global `error` / `errorRetiredBy` | `appState.ts:139-143` | transience decided by regex (`normalizeTransientError`, `errorBanner.ts:95-125`) | reads leave `error` in P1; notices are typed through `RetiredBy`; the regex is deleted in P5 |

---

## 2. Abstractions

Three client and two server abstractions, each with ≥3 callers today. `Headed`, `SingleFlight` and `daemonCall` are dropped; `RequestScheduler` is deferred.

### 2.1 Client: `ScopedResource<K, V>` (a keyed map of read entries)

**Encapsulates**: per key, one entry `{phase, fact, value, head, flight, buffer, consumers}`; the retry schedule; `readVerdict`; the scope guard.

**Evidence**: ≥12 read-lifecycle copies with 5+ enum shapes [C §2.1]; ≥15 hand-written settle scope checks [C §2.2]; 3 retry ladders [C §2.4]; the B48 table lists 13 dead-end producers.

```ts
type ReadPhase = "syncing" | "live" | "reconnecting";
type ReadFact = { kind: "none" } | { kind: "signed-out" } | { kind: "gone"; reason: "deleted" | "archived" | "project-removed" } | { kind: "forbidden" };
type Head = { namespace: string; value: string };
type Known<K, V> = { known: true; key: K; head?: Head; data: V; source: "seed" | "read" | "event" } | { known: false; key: K };
type ReadVerdict = "apply" | "merge" | "drop";

interface ScopedResourceSpec<K, V, E> {
  keyId(key: K): string;
  read(key: K, signal: AbortSignal): Promise<{ data: V; head?: Head }>;
  classify(error: unknown): "no-answer" | ReadFact;
  readVerdict(read: { data: V; head?: Head }, appliedSince: readonly E[]): ReadVerdict;
  merge?(read: V, appliedSince: readonly E[]): V;
  reduce(v: V, event: E): V;
  headOf(key: K): HeadKind;
  effect?: "read-and-clear";
  deadline: "critical-small" | "interactive";
}

interface ScopedResource<K, V, E> {
  watch(key: K): () => void;
  entry(key: K): { phase: ReadPhase; fact: ReadFact; value: Known<K, V> };
  view(key: K): V | undefined;
  event(key: K, e: E): void;
  headSeen(key: K, head: Head): void;
  wake(heads: Partial<Record<HeadKind, Head>>): void;
  subscribe(listener: () => void): () => void;
}
```

**Behaviour**
- `spec.complete(value)` (shipped in P1 slice 5): an answer the read marks incomplete keeps its value, reads again on the shared backoff while watched, and records no miss. The session board is the first reader.
- `whenAnswered(key, wanted)` (shipped in P1 slice 2) reads now and waits for an answer: a value, where one known from an earlier read counts when this read is lost, or a fact. The wait holds a watch, so lost reads keep retrying while it lasts. It ends with `undefined` when `wanted()` fails before the read, at a settle, or on `recheckWaiters()` (called whenever the selection moves), or on dispose. It serves readers that must act on an answer, such as placing a session opened from another project and opening a project's preferred workspace.
- `watch(key)` adds a rendered consumer. The consumer count drives the app row (only watched entries count) and abort-on-unwatch: the last consumer leaving makes this reader leave the flight.
- **Buffering**: an event for a key with no successful read is buffered (taken from `sessionController.ts:474-490`) and replayed through `readVerdict` when the read lands.
- **`readVerdict`** (named pure classifier, taken from `statusOrder.statusReadVerdict`): `apply` when the read covers every event applied since the read began; `merge` when events newer than the read exist (`spec.merge`); `drop` when the read is older than the applied state. **Shipped (O-P9), the merge for sets:** `update(key, change)` keeps each change made while a read is on its way and applies it again over that read's answer; a change must be a set (applying it twice is applying it once). The board takes `session.name` and `session.created` this way (`boardWithEvent`). `drop` needs heads and comes with them.
- **Head with payload**: a head is stored only in the same write as the payload it came with. `headSeen` records "a newer head exists" and never clears "needs a read" by itself (taken from `revisionScope.markFresh/markUnfresh`).
- **Shared flights**: one flight per key, ref-counted. The flight ends only when its last waiter leaves. A reader's deadline makes that reader leave and never cancels the work; the retry joins the running flight. `api/inFlight.ts` `shareInFlight` gains a join mode that does not inherit another caller's abort.
- **`wake()`** is always a heads compare. A full read happens only on a key change, a cleared fact, an epoch (namespace) change, or a moved head. There is one pending attempt per entry, so resume, online and unlock produce no herd.
- **Effect**: `effect: "read-and-clear"` disables client retry once the server may have spent the record.
- **Deadlines** (P3): `critical-small` 3 s (projects, machines, pins, heads, boot read); `interactive` 8 s (board, transcript, status), with the `messages`/`status` value set from the measured cold open. Before P3, `api/requestDeadline.ts` keeps its current behaviour.

**Invariants**: `view(key)` returns data only when `value.key` equals `key` (I1). `reconnecting` always has a scheduled next try (I5). A fact other than `none` comes only from a typed server answer. A seed renders but the entry stays `syncing` until a read, or a head compare against a current stream position, confirms it (I7).

**Pinned by**: a unit test that enumerates every phase × fact; a unit test that enumerates the three writers (read, event, head) against each other in every order; a unit test that a held 20 s shared flight with an 8 s reader deadline converges without input.

**Absorbs**: `transcriptLoadingOwnership.ts`; `controllers/trailingRefreshCoordinator.ts` (becomes one flight + a dirty flag; stop awaiting every trailing rerun, `:59-72`); read state in `projectController.ts`, `machineController.ts`, `workspaceController.ts`, `sessionController.ts:1114-1127,506-518`, `statusReadFailed`, `:1195-1197`, background tasks (`PiWebApp.ts:754-761,921`), quick switcher (`:2866-2933`), route-restore ladder (`:261,1669-1677`), goals, subagents `runsRead.ts`, `files/explorer.ts:89`, SettingsDialog ×5, fleet.

**Deleted** (in the end; P1 keeps the load unions without `failed` while their readers move to the resource): `ProjectsLoadState`, `MachinesLoadState`, `SessionsLoadState`, `isLoadingWorkspaces`, `isLoadingMachines` (gone in P1 slice 3), `transcriptFailed`, `statusReadFailed`, `BackgroundTasksRead`, the goals `read` enum, `OPENING_WORDS.failed`, the ladder constants.

### 2.2 Client: `HubRouter` (a static handler table)

```ts
type Handler<F> = (frame: F, scope: SocketScope) => void;
const handlers = { /* one entry per frame type */ } satisfies { [T in SessionUiEvent["type"]]: Handler<Extract<SessionUiEvent, { type: T }>> };
```

- Each handler calls its real owner: a resource entry (`event`/`headSeen`), the outbox/D1 reducer, the card store, or navigation. There is no dynamic `register` in core. Plugins receive only `plugin.changed`, routed by `pluginId` to the plugin's resources.
- `seq`/epoch ordering reuses `SessionGapRepair` and `RevisionScope`. Any frame resets the socket's quiet timer. After *T* quiet, one `GET /api/heads` feeds `wake(heads)`. Keepalive heads feed `wake(heads)` directly.
- The compiler enumerates the frame types: an unrouted type fails `tsc`.
- It absorbs the frame ladders in `sessionController.ts:272-275`, `machineStatusController.ts:49`, `sessionUnread.ts`, `PiWebApp.applyWorkspaceChanged`, and the `invalidateWorkspacePanels` fan-out. `socketLiveness.ts` stays; its verdict feeds a heads compare.

### 2.3 Client: `ConnectionSummary` and the app-row contract

**Input**: watched entries of the machine in use in `reconnecting`, plus that machine's socket state, reduced to a typed cause. A definite notice (§1.11, §2.1 facts) is the second input; only one is shown at a time:

```ts
type RowCause = { kind: "link-down" } | { kind: "machine-unanswering"; machineId: string } | { kind: "daemon-restarting" } | { kind: "server-error"; machineId: string; reason: string };
type RowState = "hidden" | "grace" | "shown" | "holding";
```

**Where a cause comes from** (shipped in P1 slice 4 as `ReadMiss`, decided once by the pure `classifyReadError`; `daemon-restarting` has no producer among the reads the row watches yet and arrives with the P2 session reads):

| a read that failed with | outcome | retries |
|---|---|---|
| no status: a dropped connection, a reader deadline | `link-down` | yes |
| 401 / 403 | fact `signed-out` / `forbidden` | no |
| 502, 503 or 504 whose body names a remote machine (PI WEB's gateway adds `machineId`; a proxy's own 502 page does not) | `machine-unanswering(machineId)` | yes |
| any other 502, 503 or 504 (a proxy in front of PI WEB, a restarting process), or no status at all (0) | `link-down` | yes |
| any other status (500, a protocol 404, …) | `server-error(machineId, reason)`, the reason being the error's own words | yes |

Each entry keeps its latest miss; `unanswered(keys)` answers since when the earliest watched key has gone unanswered and why. A read's server error rides the same lifecycle as reconnecting: it retires when an answer comes, with no cross and no expiry. An action's server error stays a notice (§1.11).

The machine health and runtime reads, and the deep-link ladder, speak through the same classifier. These reads are answered by the web process in use, which reports a down remote as `ok:false`, so a failed read is never evidence about the remote:
- nothing answered: no notice (the row speaks), unless the reader asked (Settings);
- the gateway said the remote did not answer: the machine, named;
- a server error or a refusal: its own words.

A remote's health whose read failed is `unknown`, and the ladder names the machine only when the web process answered that it is down.

| Cause | Wording |
|---|---|
| `link-down` | "Reconnecting…" |
| `machine-unanswering(m)` | "*m* is unavailable; reconnecting…" (the owner's composed form, already used by the machine health notice) |
| `daemon-restarting` | "*m* is restarting; reconnecting…" |
| `server-error(m, reason)` | "*m*: *reason*" (the error's own words; never "reconnecting", Q9) |
| another machine, or one project or workspace, not answering | nothing: silent background retries (Q3) |

**Lifecycle** (pure classifier, extends `components/bannerHold.ts`):
- The **sub-state** `unanswered-since-first-miss` begins at the first miss and persists through retries, so the row does not flicker per retry.
- `hidden → grace` on the first miss; `grace → shown` after 4 s (`TRANSIENT_GRACE_MS`) if still unanswered; `shown → holding` on an answer; `holding → hidden` after the minimum visible time (`BANNER_MIN_VISIBLE_MS`, 1.5 s).
- **No expiry** (`TRANSIENT_ERROR_TIMEOUT_MS` does not apply) and **no dismiss** (no cross) for the reconnecting claim.
- It renders above the dialog layer (portalled to the top layer, above `--pi-layer-dialog`, `SettingsDialog.ts:790`).
- **One claim at a time** (owner, Q1: a definite failure is a different meaning from "not synced", and only one shows at a time). A definite claim (an action failed, an outcome unknown, an action's server error) holds the row until it is dismissed or retired; a read's server error retires itself when an answer comes. The reconnecting claim returns afterwards if it is still true. The pure classifier takes both inputs and names the one it shows.

**Time to row**: deadline + grace (3 s + 4 s = 7 s for small critical reads; 8 s + 4 s = 12 s for the board and transcript).

**Pinned by**: a unit test that enumerates `RowState × event`; a 393×850 probe that counts row mounts over 30 s of injected loss (expected: 1); a probe with Settings open under a held read.

### 2.4 Client: `PersistentSeed` (transcript tail only, P6)

- IndexedDB store keyed by `(machine, session)`: tail rows + head + savedAt, written together, debounced during streaming, evicted by LRU under a total budget (proposed 20 MB; not a per-entry drop, `chatHistoryCache.ts:126-135`).
- Lookup order: memory LRU (sync) first, then IndexedDB (one async hop). A seed never sets `live`.
- Board and projects seeds are not built until a measurement shows a need.
- It deletes the `chatHistoryCache.ts` localStorage path and `pi-web:chat-watermark:v1:`. Private mode or no quota means no seed.

### 2.5 Server: heads and publish

- **`headSources`**: `Record<HeadKind, () => Head>` on `SessionEventHub` (precedent: `setTranscriptHeadSource`, `piSessionService.ts:2738`). `HeadKind = board | unread | machineStatus | machines | pins | transcript | stream | plugin:<id>`. The keepalive of a scope carries its heads; `GET /api/heads` returns them.
- Every head is `{namespace, value}`. The namespace is the writer's instance id (`daemonInstanceId`, `epochId`); the global scope gets an epoch, so a restart never fools a compare.
- **Publish contract** in `shared/` (a `ChangeKind` type and the nudge message in `shared/sessiondClient/`). The implementation lives on the daemon hub. Web writers (projects in `web/app.ts:79-90`, pins in `web/sessionPinRoutes.ts`, config, machines) send a nudge through `shared/sessiondClient` after the write. The daemon republishes (`machine.status` for projects and workspaces; `pins.changed`, `machines.changed` otherwise). If the daemon is down, the row is showing anyway and heads catch up.
- Silent daemon writers (archive, delete, restore, attachments) publish in the same tick as the write. **Pinned by**: one server unit per writer.

### 2.6 Server: single-flight and deadlines, without new abstractions

- **Store scan**: a `Map<string, Promise>` inside `daemon/sessions/sessionSummaryScanner.ts`, keyed by `(store, version)`, plus a global fs concurrency of 4 (libuv pool). 22 identical scans become 1 [S §5.2].
- **Provider resolve**: extend the existing `pendingResolutions` (`workspaceProviderRegistry.ts:206-220`) with a short verdict cache.
- **Session open**: the existing `getOrOpen` is already shared by status, messages, stream-snapshot and background-tasks [S §5.3]. The rule is that a caller's abort leaves the open; it never cancels it.
- **Deadlines**: `DEADLINE = { criticalSmall: 3_000, interactive: 8_000, poll: 5_000, mutation: 25_000 }` in `shared/sessiondClient/`. Each forward passes `AbortSignal.timeout(DEADLINE[class])`, combined with `AbortSignal.any` with the client-gone signal where one exists. Forwards: `web/sessionProxyRoutes.ts:23` (today `boundDaemonRequest`, 25 s), `terminalProxyRoutes.ts:146`, `pluginBackendProxyRoutes.ts:29`, `pluginOperationProxyRoutes.ts:25`, `workspaceDeletionRoutes.ts:29`, `sessionDaemonWorkspaceCatalog.ts:65`, `piWebStatus.ts:338`, `shared/sessiondClient/sessionDaemonClient.ts:103` [S §3, §4.1]. `web/boundedDaemonRequest.ts` shrinks to that call.
- **Plugin operations**: bounded by the existing `runBounded` (`shared/plugins/serverPluginRuntime.ts:662`), per-plugin concurrency 2.

### 2.7 Deferred: `RequestScheduler`

The case for it (peak 22–24 concurrent, 13–26 queued [N §1]) is mostly fan-out that P4 and P5 remove. Re-measure concurrency after P4. If it is still needed, ship only a per-machine lane cap in `api/http.ts`: background reads take at most 2 slots, so critical reads always have 2 of the 4 `/api` slots, and a remote machine holds at most 2.

---

## 3. Module map

Dependency direction: component → controller → `sync/*` → `api/http.ts`. Plugins → `src/plugin-api.ts` → `sync/*`. A plugin never uses `fetch` or `setInterval` for shown data. `bob.config.json` `writePaths` gains `src/client/src/sync/` in P1.

### 3.1 Client (`src/client/src/`)

| Object | Owner module | § |
|---|---|---|
| ReadPhase, readVerdict, ScopedResource | **new** `sync/readPhase.ts` (pure), `sync/scopedResource.ts` | 2.1 |
| Flight join mode | `api/inFlight.ts` (grown) | 2.1 |
| Reader deadlines | `api/requestDeadline.ts` (grown, P3) | 2.1 |
| Hub router | **new** `sync/hubRouter.ts` (uses `sessionGapRepair.ts`, `revisionScope.ts`, `socketLiveness.ts`) | 2.2 |
| Row | **new** `sync/connectionSummary.ts` → `components/errorBanner.ts`, `components/bannerHold.ts` | 2.3 |
| Transcript seed | **new** `sync/persistentSeed.ts` (P6) | 2.4 |
| Machines / projects / workspaces | `controllers/machineController.ts`, `projectController.ts`, `workspaceController.ts` (sole writers) | 2.1 |
| Board | **new** `controllers/sessionBoard.ts` (P4) | 2.1 |
| Selected session | `controllers/sessionController.ts` shrinks to selection + reducers; `chatTranscriptStore.ts` | 2.1 |
| Outbox | `pendingOutbox.ts` | — |
| Unread | `sessionUnread.ts` | 2.1, 2.2 |
| Navigation | `navigationIntent.ts` (drop `failed`, `stalled`) | 1.18 |
| Plugin panels | `plugin-api.ts` `host.resource(spec)` | 2.1 |

### 3.2 Server (`src/server/`)

| Object | Module | Process |
|---|---|---|
| Projects store | `shared/storage/projectStore.ts`; writer `web/app.ts` + nudge | web |
| Pins store | `shared/storage/sessionPinStore.ts`; route `web/sessionPinRoutes.ts` + nudge | web |
| Plugin runtime, operation bound | `shared/plugins/serverPluginRuntime.ts` (`runBounded`) | both |
| Deadline constants, publish nudge contract | `shared/sessiondClient/` | both |
| Forwards | `web/boundedDaemonRequest.ts` + 7 forwarders | web |
| Heads route | **new** `web/headsRoutes.ts` (proxies the daemon's heads through `shared/sessiondClient`) | web |
| Batched boot read | **new** route in `web/headsRoutes.ts` (web-owned values + daemon statuses/interrupted) | web |
| `headSources`, publish | `daemon/realtime/sessionEventHub.ts` | daemon |
| Board read | **new** `daemon/sessions/sessionBoard.ts` | daemon |
| Scan single-flight | `daemon/sessions/sessionSummaryScanner.ts` | daemon |
| Not-found typed error, unread without flush, `messagesPassive` | `daemon/sessions/piSessionService.ts` | daemon |
| Machine status | `daemon/status/machineStatusService.ts` | daemon |
| Provider verdict cache | `daemon/workspaces/workspaceProviderRegistry.ts` | daemon |
| Watcher filter + coalescing | `daemon/workspaces/workspaceWatcher.ts` | daemon |
| Socket drop counters | `daemon/realtime/sessionEventHub.ts`, `web/webSocketBridge.ts` | daemon / web |
| Startup phase timing, loop delay | `sessiond.ts` + daemon `/health` | daemon |

`web/` never imports `daemon/` and the reverse; everything that crosses goes through `shared/sessiondClient`.

---

## 4. Network plan

### 4.1 Today's critical paths [N §2, measured on 8505]

- **Boot**: 96–97 requests, 1.02 MB, ~40 `/api`, peak 22–24 concurrent on HTTP/1.1, ~57 unbundled plugin modules (≈700 KB), 8 duplicate reads [N §1].
- **Open session (daemon-cold, 17.8 MB)**: projects → 6× workspaces → 7× `sessions?cwd=` (~1.3 s TTFB) → status/messages/stream-snapshot/background-tasks (0.8–1.8 s, one shared cold open) → first row at 3.45 s (5.95 s on run #1). Warm: first row at 0.84 s; a warm reload sends the same 110 requests.
- **Idle**: 0 HTTP/min, ~0.4 KB/min [N §3].
- **Daemon startup**: the 8505 daemon started listening 31.4 s after its plugins activated, with nothing logged in between (12:07:53 → 12:08:25Z).

### 4.2 Target critical paths

- **Open a session from a route with `cwd`**: (1) memory seed → render (P6 adds the IndexedDB tail, target ≤400 ms warm); (2) in parallel, `messagesPassive` tail page (returns head) and `status` (opens the runtime); no stream-snapshot gate; (3) the boot read; (4) background-tasks, runs, version, plugin prefetch.
- **Boot (no session)**: one batched boot read (config, machines, projects, statuses, pins, interrupted), then the board and heads. Target ≤8 `/api` reads, **background reads included**.

### 4.3 Budgets

| Budget | Today | Target | Phase |
|---|---|---|---|
| requests at boot | 96–97 | ≤25 | P7 (bundling) |
| `/api` at boot, background included | ~40; **24** on 2026-10-01 (`probe-budgets.mjs` guards it as a ceiling): 6 shell facts (`pi-web/status` twice: core and the updates plugin), 8 machine facts, 1 plugin, 5 workspace, 4 session open | ≤8, through composite reads (P7 slices b-d); under HTTP/2 each saves at most one round trip, so they wait behind work the reader feels | P4, P7 |
| max `/api` concurrency | 13–15 | measure after P4 | 2.7 |
| idle bytes/min, panels closed | ~0.4 KB | ≤1 KB | — |
| idle, git/files panel open | ≤245 req/min; 40–47/min after the watcher fix (the subagents run list every 3 s, and the pins re-read on each render it caused); **files 0/min, git 14–16/min, subagents 1/min** after P3b (git status 7, pins 7–8) | ≤8/min, plus head checks at 4/min | P3, P5 |
| pins reads/min | 30; 7 with the git panel open after P3b (re-read on each render older than 2 s) | ≤1 | P5 |
| first transcript row, warm | 0.84 s; **0.33–0.38 s** after P2c + P3a; **225 ms** on 2026-10-01 (`probe-budgets.mjs`) | ≤400 ms | P6 |
| first transcript row, cold 17.8 MB | 3.5–6.0 s; **1.11–1.34 s** after P2c + P3a (phone, daemon-cold, `probe-open-latency.mjs`); **1.27–1.74 s** on 2026-10-01, three restarts in a row: only the first, right after a rebuild with the OS file cache cold, misses | ≤1.5 s | P2, P3 |
| session read's wait on lists | 0.55–1.5 s | 0 (with `cwd`) | P2 |
| board read p99 | 23 s (list) | ≤1 s | P3, P4 |
| time to the reconnecting row | 10.5–29 s | deadline + grace (7 s small / 12 s large) | P1, P3 |
| daemon listen after plugin activation | 31.4 s | measured, then the slowest phase fixed | P3 |
| first row on a deep link at a 100 ms round trip (`probe-boot-latency.mjs`) | 2.29–2.41 s; **1.36–1.49 s** after P7a (all 15 plugins), both over HTTP/1.1; **1.07–1.33 s over HTTP/2**, which production speaks (§4.7) | ≤0.8 s with a remembered place (waits on the owner); place-before-plugins dropped (owner: everything at once) | P6, P7 |
| browser plugin modules at boot (`probe-boot-latency.mjs`) | 55–70 files, imported up to ten levels deep (1.34 s of round trips at 100 ms); **one file per plugin** after P7a, asked for within 1 ms | one level | P7 |

### 4.4 B28 board read and heads

- `GET /api/sessions/board` → `{ head, projects: [{id, revision, workspaces: [{id, revision, state: listed|unknown, sessions: [SessionInfo & {lastActivityAt}]}]}] }`. It replaces 1 + P + W fan-out and the quick switcher's copy. It is computed from one single-flight scan, with no flush; it keeps an **idempotent** unread reconcile and the archive-notification clear (the owner of both after `list` stops writing). Payload measured on the real store (65 dirs, 2,038 files) before P4 ships.
- The daemon keepalive carries daemon heads only: `board`, `unread`, `machineStatus`, `stream`. Projects and workspaces ride `machine.status`. Pins and machines heads arrive in P5 with the web nudge.
- After *T* quiet, `GET /api/heads` is read, and only entries whose head moved are re-read.

### 4.5 Slow remote machines and long-held requests

- Reader deadlines type the row cause `machine-unanswering(m)`. Daemon work is not cancelled by a reader leaving (§2.1, §2.6).
- If §2.7's measurement demands it, a per-machine lane cap of 2. **Shipped for the board (P3a):** the measurement demanded it. Since P4 slice a the board is one request and its listings are the web process's, so the lanes apply only to filling a partial board's gaps and to a machine without the board route. The board's seven cold listings held all six HTTP/1.1 connections for about 1.1 s, and the plugin modules the route restore waits for queued behind them (queued at 218 ms, sent at 1294 ms, served in 1–5 ms). The board now reads through `mapWithLanes(…, 2)` (`sync/lanes.ts`), and the selected session's refresh asks for the transcript before the status, so the transcript gets the first free connection.
- Plugin operations are bounded (`runBounded`), with per-plugin concurrency 2.

### 4.6 The 10–29 s tail

Most likely cause: the daemon's single event loop is blocked in bursts by whole-store scans and cold opens, multiplied by unbounded fan-out. Evidence: an 18.74 s window with zero daemon log lines while web answered in <1 ms; a 10 s provider timer firing at 18.8 s; 90 of 621 slow requests reaching the daemon 1.5–27.4 s after being sent [S §5.1]; 22 identical scans finishing together at ~11 s [S §5.2, N §4]; one 24.6 s cold open shared by three reads [S §5.3]. It is aggravated by the `workspace.changed` storm [N §4]. Not established: no loop-delay metric exists [S §6].

Fix, in phase order (P3 unless noted):
1. Measure: `monitorEventLoopDelay()` on daemon `/health`; log request queueing >500 ms; time the daemon startup phases.
2. Single-flight scan + fs budget. **Shipped (P3a):** `SessionSummaryScanner` runs one pass per directory for scans that overlap; each caller gets its own list. A joiner can miss a file written during the pass, and the next listing has it.
3. Watcher filter + 2 s coalescing.
4. Unread without flush.
5. Only then, deadlines on every forward (a reader leaves; the work continues).
6. Board read replaces per-workspace lists (P4).
7. Cold open beyond the tail page depends on the SDK `SessionManager.open` cost; measure it before designing.

**Daemon startup outliers (measured 2026-10-01).**
- **Numbers.** 112 starts of 8504, from the daemon's first log line to listening: p50 1.7 s, p90 6.9 s, worst 42.6 s; 13 starts took over 5 s. The process start adds about 1 s before the first log line. 8505 starts in 1.1 s at p50.
- **Where the time goes.** In a 38.8 s start, 38.7 s is one call: `bootstrapAndFreezeGlobalExtensionProviders` loading the global pi extensions before the daemon listens.
- **A cold transpile cache explains 5 s, not 40 s.** Measured with `/tmp/bootstrap-timing.mts`: 1.3 s warm, 6.6 s with the jiti cache moved aside.
- **The likely cause of the 30–40 s starts is the account-store lock.** The pi-multi-account extension reads the account store while it loads. Until today each read took pi-accounts' exclusive cross-process lock, with about 40 s of retries, and every pi process on the machine (the other daemon, the TUI, background agents) reads it on every turn. The worst starts sit at that budget.
  - The extension's lock-free reads (`ddba988`, `f9c4821`) remove the wait once a daemon loads them.
  - Not reproduced: holding the lock would fail the 8504 daemon's live requests, because that daemon still runs the old extension. Confirm with the next starts after 8504 restarts.
- **What remains:** an npm install of a package in `settings.json` that is missing, or whose installed version no longer matches its range, still runs before listening. Making the daemon listen before its extension bootstrap is a separate design (sessions must not load before the provider baseline is frozen).

---

### 4.7 The boot on a slow link (P6 slice b onward, P7)

**Measured** on 8505, phone 393x850. A warm reload of a deep link to the small seed session, with Chrome emulating the round-trip latency and the bandwidth unthrottled (`/tmp/boot-chain-latency.mjs`, then `probe-boot-latency.mjs`):

| Added latency | First row | Projects read sent | Workspaces read sent | Sessions read sent |
|---|---|---|---|---|
| 0 ms (8505 local) | 232 ms | 52 ms | 166 ms | 214 ms |
| 50 ms | 1,638 ms | 366 ms | 1,502 ms | 1,571 ms |
| 100 ms (a tailnet; the Mac reading 8504) | 2,290 ms | 570 ms | 2,016 ms | 2,138 ms |

The gap between the projects read and the workspaces read is not a read. `restoreRouteFor` awaits `loadPluginsForSelectedMachine()` before it selects anything, so that the route's `tool` and `view` can be resolved against plugin-registered panels.

The built-in browser plugins shipped as about 70 module files. Eight entries imported only their own files, so the build left them unbundled, and their imports went up to ten levels deep. At 100 ms each level is one round trip, on the same six HTTP/1.1 connections as the app's own reads. The timeline:

- the plugin entries at 368 ms;
- their imports at 601, 762, 898, 1,074, 1,217, 1,388, 1,526, 1,658 and 1,817 ms (`relays/vendor/marked.esm.js`);
- the route restore at 1,956 ms.

The request count matters less than this: 24 `/api` reads cost about one round trip each on six connections, while the plugin waterfall costs ten in a row.

**Correction (2026-10-01): production speaks HTTP/2.** 8504 is published through `tailscale serve https:8504`, and the phone negotiates HTTP/2 (`curl` reports `2 200`; forcing `--http1.1` gives 1.1). The table above and the P7 slice a numbers were measured over plain HTTP to `127.0.0.1`, where Chrome is held to six HTTP/1.1 connections, so every boot request queued in waves. HTTP/2 multiplexes them on one connection, so production never had that queue. Measured again through a local HTTP/2 TLS front for 8505 (`/tmp/h2-proxy.mjs`), same deep link, after P7 slice a:

| Added latency | First row (HTTP/2) | First row (HTTP/1.1, same build) | Projects read sent | Workspaces read sent | Sessions read sent |
|---|---|---|---|---|---|
| 0 ms | 335 ms | 232 ms (before P7a) | 95 ms | 229 ms | 300 ms |
| 50 ms | 950 ms | 1,638 ms (before P7a) | 478 ms | 775 ms | 864 ms |
| 100 ms | 1,071–1,326 ms | 2.0–2.1 s | 488–631 ms | 706–913 ms | 830–1,090 ms |
| 150 ms | 1,651 ms | | 849 ms | 1,129 ms | 1,352 ms |

What a reader on the tailnet waits for is serial depth, not request count: the document, the app bundle, the boot reads with the plugin manifest (about 400–500 ms at 100 ms), the plugin modules and the projects read (one round trip), then the workspaces read and the sessions read, two round trips that only confirm the place before the session is selected. A warm reload draws its first row from the cached transcript the moment the session is selected, so those last two round trips are the largest piece left. The boot probes measure through an HTTP/2 front from now on; an HTTP/1.1 number is not a production number.

**The slices, ordered by what a reader on a slow link feels:**

1. **One file per plugin** (P7 slice a, build). **Shipped.**
   - Every built-in browser plugin entry is bundled in place into one module. A lazy `import()` of a computed URL (mermaid's vendored engine) stays lazy, and `import.meta.url` still names the entry.
   - The boot asks for the 15 plugin modules within 1 ms of each other.
   - At 100 ms the first row moved from 2.29–2.41 s to 1.36–1.49 s.
     - An earlier 1.17 s was measured while three plugins were withheld as stale (`dist` had been rebuilt under the running stack), so it is not counted.
   - **What is left:** the 15 entries and about 13 `/api` reads, all issued around 300–400 ms, queue on HTTP/1.1's six connections to one host. The plugins finish around 930 ms (the updates plugin's activation read). The workspaces → sessions → row chain then costs about three more round trips. Slices 2 and 3 address both.
   - Guard: `browserEntryResolvable.test.ts` fails when a shipped entry statically imports anything.
2. **The place before the plugins** (P6 slice b). **Dropped** (owner, 2026-10-01: everything at once). A session's text does not show before the plugins that draw parts of it, so the route restore keeps waiting for them. Under HTTP/2 the plugins cost about one round trip after the manifest, which the projects read shares.
3. **A remembered folder seeds the open** (P6 slice c, browser only; replaces "`cwd` in links").
   - The page remembers each session's folder, keyed by machine and session.
   - A deep link or reload asks for the transcript tail at once, in parallel with the route chain.
   - The chain's typed place (`found | outside | unknown`) wins over the seed when they disagree. An early read for a session that turns out gone shows nothing until the chain says gone.
   - With everything at once, the seed does not show the session before the plugins. It lets the session be selected as soon as the plugins and the projects read are in, instead of two round trips later (about 250 ms at 100 ms, measured under HTTP/2).
4. **Fewer `/api` reads at boot** (P7 slices b–d). These are measured again after 1–3, since each is worth one round trip or less once the waterfall and the chain are gone:
   - one shell-facts answer (config, version, self-update status, roster), with a fallback for an older web process;
   - `pi-web/status` given to plugins as a host fact instead of read again by the updates plugin. **Shipped (P7 slice c, browser only).** `PiWebStatusController.read(machineId)` is the one read: it joins a read on its way and reuses an answer for 30 s. Plugins get it as `PluginActivationContext.readPiWebStatus`, which reads the status of the registration's own machine. An older host leaves it absent, so the plugin reads `api/pi-web/status` itself there. The web process already caches this status for 60 s, so reuse adds at most 30 s of age to an answer the server already accepts. "Check for updates" still asks the machine too, and its answer is what the next reader gets, even when an older read lands after it (review `19347e5e`).
   - the opened session's status, thinking levels and background tasks in one read;
   - the socket's open delivering its snapshot (unread, statuses, interrupted) as its first frame.

## 5. Consistency invariants

| # | Invariant | Enforced by | Pinned by |
|---|---|---|---|
| I1 | **Data carries its scope.** A value is stored with its full key; an old-key value never renders and is never actionable. | `Known.key`, `view(key)` per entry | unit: switch machine mid-read; 393×850 probe: switch project under a held read; P6 blank-frame probe |
| I2 | **Absence is not negation.** `known:false` renders no empty-state text; aggregate sources that did not answer stay as `unknown`. | render reads `value.known`; board `state` | unit per list; probe: block the workspaces read → no "No workspaces found" (`PiWebApp.ts:3139-3143`) |
| I3 | **One row and one state per message.** | outbox + D1 reducer, reached from one router handler | existing D1 tests; offline send → reconnect → reload probe |
| I4 | **FIFO.** Inbox `seq`; cards FIFO; frames in `seq` order. | daemon inbox; `SessionGapRepair` | existing tests; frame-drop probe |
| I5 | **No final "failed" for a read without an answer.** `reconnecting` always has a scheduled next try; a reader deadline never cancels shared work. | `classify` → `no-answer`; ref-counted flights | unit: every phase × fact, a timer exists in `reconnecting`; unit: held 20 s flight vs 8 s deadline converges; probe: abort one projects read on a phone → converges without input |
| I6 | **Syncing is invisible; reconnecting is one row** with grace, minimum visible time, no expiry, no dismiss, above dialogs. | `ConnectionSummary` is the only renderer of phase | `RowState` enumeration unit; probe: row mounts = 1 over 30 s of loss; Settings-open probe |
| I7 | **A seed is not live.** Value and head are written together; a seed is confirmed only against a current `{epoch, seq}`. | `source:"seed"`; transcript head `{epoch,seq,n,leaf}` | unit: foreign-epoch seed → diverged; unit: mid-answer seed with an equal `{n,leaf}` and a moved `seq` → read |
| I8 | **Every client-visible write publishes.** Daemon writers publish in the same tick; web writers nudge through `shared/sessiondClient`. | `headSources` + publish contract in `shared/` | server unit per writer; probe: add a project in tab A → tab B shows it within one frame |
| I9 | **Converge within *T* of reachability**, through heads compares only. | quiet timer + `/api/heads` + per-panel head check | sync-convergence fault probes 1–5 |
| I10 | **One read in flight per key; no poll while events flow.** | ref-counted flight; first-party `setInterval` repo test (voice on the allowlist) | unit; idle probe: 0 HTTP/min beyond head checks with panels open |
| I11 | **State is never decided by display text.** | typed `RowCause`; notices typed through `RetiredBy` | grep test scoped to the read surfaces (P1); repo-wide `normalizeTransientError` gone (P5) |
| I12 | **Only reader intent moves the page; a session opens unless deleted or archived**, and those come from the typed not-found code or session data. | D8 + `ReadFact.gone` from `{code:"session-not-found"}` | existing D8 tests; unit: protocol 404 → `no-answer`; probe: open under a held read → `going`, row, then commits |
| I13 | **An event is never erased by an older read, and a head never stands without its payload.** | `readVerdict`, event buffer, head-with-payload | the three-writer enumeration unit |
| I14 | **A spent effect is not retried.** | `effect: "read-and-clear"` | unit: lost answer on `interrupted` → no second GET |

---

## 6. Migration plan

Each phase ships green, is probed on 8505 (393×850 coarse pointer where it matters on a phone), and carries a patch changeset.

**P1: ReadPhase + ScopedResource on projects, machines and workspaces; the row contract.**
- Scope: `sync/readPhase.ts`, `sync/scopedResource.ts` (keyed entries, `readVerdict`, buffer, ref-counted flights, `wake` as a heads compare), `sync/connectionSummary.ts`; `api/inFlight.ts` join mode; `projectController.ts`, `machineController.ts`, `workspaceController.ts`; `locateAndApplySessionWorkspace` moved in, writing through the resources; `errorBanner.ts`, `bannerHold.ts`, `AppNavigatePage.ts`, `ProjectList.ts`, `WorkspaceList.ts`; `bob.config.json` `writePaths` += `src/client/src/sync/`.
- The row is portalled above the dialog layer, with the Q1 precedence behind one constant.
- Deletes: `ProjectsLoadState`, `MachinesLoadState`, `isLoadingWorkspaces`, `isLoadingMachines`, "Couldn't read the projects…", the Retry button, the "Loading projects/workspaces…" titles (Q2), the `normalizeTransientError` doc comment block (`errorBanner.ts:69-75`) and `isTransientError`'s classification-seam role (`notice.ts`), plus read producers of `error`.
- Proof: phase × fact, three-writer and `RowState` unit tests; the grep test on read surfaces; a phone probe that aborts the first projects read (converges without input, no empty text, row mounts = 1); the Settings-open probe.
- Daemon restart: **no**.

**P2: session open off the chain.**
- **Precondition (daemon restart)**: a typed `{code:"session-not-found"}` from a typed error, with every other failure a 5xx; archived from session data; `HttpError.code`; `classify` keyed on the code.
- Scope: the first tail page via `messagesPassive` (with `head`); the runtime open in parallel for `status`; transcript and status as independent resources; the transcript head `{epoch,seq,n,leaf}`; drop the `Promise.all` gate and serial `streamSync`; `cwd` written into app-made links, starting session reads from the route with a fallback to the chain; `navigationIntent.ts` drops `failed` and `stalled`, adds `gone`; `transcriptLoadingOwnership.ts` absorbed; `trailingRefreshCoordinator.ts` await semantics.
- Deletes: `transcriptFailed`, `statusReadFailed`, `OPENING_WORDS.failed`, "Still opening…", the route-restore ladder.
- Proof: cold 17.8 MB first row ≤1.5 s, warm ≤0.84 s; a protocol 404 stays reconnecting; deleted/archived show their reasons (Q5); a mid-answer head probe.
- Daemon restart: **yes**.

**P3: daemon tail (measure first, deadline last).**
- Order: (1) `monitorEventLoopDelay` on `/health`, request-queueing log, **daemon startup phase timing** (then fix the slowest phase); (2) the scan `Map<string, Promise>` + fs budget 4, the provider verdict cache; (3) the **watcher filter** + 2 s coalescing; (4) unread without flush, with `list` keeping only its reconcile until P4; (5) socket drop counters; (6) only after (2) is live, `DEADLINE` constants + `AbortSignal.timeout` on the 8 forwards and client reader deadlines (3 s / 8 s, `messages`/`status` from the measured cold open); plugin operations bounded.
- Proof: loop delay p99 before/after on the 22-workspace switcher probe; server single-flight tests; a held 20 s cold open converges; the git panel idle probe ≤8/min; daemon startup time recorded before/after.
- Risk: unread timing for other workspaces [S §2.7]. Daemon restart: **yes**.

**P4: board read, daemon heads, batched boot read (B28).**
- Precondition: board payload measured on the real store.
- Scope: `daemon/sessions/sessionBoard.ts` (idempotent reconcile, no flush); `headSources` for `board`, `unread`, `machineStatus`, `stream` on the keepalive; `web/headsRoutes.ts` (`/api/heads` + boot read); client `controllers/sessionBoard.ts`; the quick switcher reads the board; `lastActivityAt` ordering (Q7).
- Deletes: per-workspace list fan-out, the sessions retry backoff, the quick switcher loader, `workspaceSessionsCache.ts`, the reconcile and clear inside `list`.
- Proof: boot `/api` ≤8 including background; cross-tab re-sort probe; *T*-quiet probe = one heads read, no list read.
- After P4: the concurrency measurement for §2.7. Daemon restart: **yes**.

**P5: router, web publish, plugins, notices.**
- Scope: `sync/hubRouter.ts` (static table); the publish contract in `shared/sessiondClient/`, with web writers (projects, pins, config, machines) nudging; `pins`/`machines` head sources; daemon silent writers publish; `plugin-api.ts` `host.resource` + `plugin.changed`; goals, subagents, git, terminal, files; per-panel head checks every *T*; the first-party `setInterval` repo test; third-party deprecation (Q8); notices typed through `RetiredBy`.
- Deletes: plugin intervals (3 s, 8 s, 1 s), `PIN_REFRESH_MS`, the goals single slot, **`normalizeTransientError`**, the frame ladders.
- Proof: the router compiles only when complete; idle probe; cross-tab add-project probe; repo-wide grep test.
- Daemon restart: **yes**.

**P6: transcript tail seed (IndexedDB).**
- Memory LRU first, then IndexedDB; debounced writes; `bottomAnchorAction` for seed → live; the previous pixels stay, non-actionable.
- Deletes: `chatHistoryCache.ts` localStorage and the watermark keys.
- Proof: warm first row ≤400 ms; switch probe counting blank frames; scroll-position assertion; foreign-epoch seed probe.
- Daemon restart: **no**.

**P7: boot weight and drafts.** Bundle first-party plugins in production builds and keep per-module loading in dev. Lazy-load `files` and `terminal`. Draft key migration (Q6). Daemon restart: **no**.

---

## 7. Owner decisions (2026-09-30)

- **Q1, the row**: one claim at a time; a definite failure is not reconnecting (§2.3).
- **Q2, tap acknowledgement**: the spinner, "Opening…" and the progress line stay; "Still opening…" and the Loading titles go (header, §1.18).
- **Q3, the first transcript read**: "Loading this session…" (§1.7).
- **Q4, an unanswered source**: only the machine in use shows in the row; other machines and single sources retry silently (§1.5, §2.3).
- **Q5, other actions**: fire now, pending, never replayed; an unknown outcome is said (§1.11).
- **Q6, the git watcher**: researched first, as asked (run 8f558e71); the design follows VS Code and GitLens: a `.git` whitelist, tree exclusions, 250 ms and 2.5 s windows, visibility gating, and our own operations merged (§1.16).
- **Q7, board order**: live, held while touching or scrolling (§1.5).
- **Q8, archived or deleted by link**: read-only with Restore, or the reason and a way back (§1.18).
- **Q9, server errors**: the row shows the error reason, not reconnecting (§0, §2.3).
- **Q10/Q11, pins** (B49): pins stay global and keep working after their project closes; opening one does not reopen the project; closing says nothing (§1.14). The owner's follow-up: global and project pins are two separate kinds (§1.14).
- Engineering calls, not asked: legacy drafts adopted lazily (§1.20); third-party plugin polling deprecated for one release (§1.16); a read's server error in the row retires itself when an answer comes, like reconnecting, rather than holding the row until dismissed (§2.3, P1 slice 4).

---

## Inventory gaps

- Whether sync-convergence Phase A (`head` on `/messages`, `/sessions/heads`) and the new D1 frames have landed is not established.
- Plugin timers while hidden, the hub event list for projects/workspaces, and tasks `configCache` retention were not traced [C residual].
- The 8504 build during the log window is unknown, so the git/tree storm may predate 89ac8308 [N residual]. It reproduced once on 8505.
- The server lane's H9 (termination at >1 MiB turning stalls into resyncs) rests on code only.
- Server H8: 195 of 621 slow requests had a fast daemon handler; web re-encoding versus browser queueing is not separated [S §5.8, §6].
- The daemon's 31.4 s startup gap has no phase breakdown yet (P3 step 1).
