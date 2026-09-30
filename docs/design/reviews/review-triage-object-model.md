# Review triage: the object model (run 7b4fe5b7)

Design: `docs/design/object-model.md`, built on the draft from the synthesis lane.

Inputs:
- **Inventories:** client (Opus), server (DeepSeek), network (Opus, measured on 8505 and the 8504 log).
- **Reviews:** architecture (Opus), sync red team (DeepSeek), product (Opus). All three used the bob and ponytail lenses, and all three returned **sound with changes**.

Verdict key:
- **accept**: the design changes as stated;
- **owner**: a product question for the owner (ask of 2026-09-30);
- **reject**: not true, with the reason.

## Architecture lane (A)

| id | finding | verdict |
|---|---|---|
| A-F1 | `publishChange`/`Headed` placed in `daemon/`, while the writers (projects, pins) are web/shared. The bob archRule is broken | accept. Web writes nudge the daemon through the existing `shared/sessiondClient`. Projects and workspaces ride the existing `machine.status` projection (`revision + epochId`, join frame). No `projects.changed` event, no persisted projects revision |
| A-F2 | `daemonCall` in `web/`, with call sites in `shared/` | accept. Deadline-class constants in `shared/sessiondClient/`; each forward passes `AbortSignal.timeout(DEADLINE[class])` (standard library), combined with the client-gone signal where there is one. No new function |
| A-F3 | `gone(deleted)` from a daemon 404 that means "any error" | accept (with S-F5). **Precondition to P2 (daemon restart):** a typed `{code:"session-not-found"}` from a typed error, and every other failure is 5xx. Archived comes from session data. `classify` switches on the code |
| A-F4 | `locateAndApplySessionWorkspace` is a second writer of projects and workspaces left by P1 | accept. It moves into P1 and writes through the resources |
| A-F5 | `ScopedResource` holds one key; the state it replaces is keyed by many ids | accept. A keyed map of entries (phase, fact, value, one flight). "Selected" becomes a count of rendered consumers, which drives the app row and abort-on-unwatch |
| A-F6 | `runs.changed` special-cases a plugin | accept. It goes through the generic `plugin.changed` |
| A-F7 | "The plugin API exposes no interval" cannot be enforced | accept. A repo test forbids `setInterval` in first-party plugin browser code, with an allowlist (voice). Q8 is reframed for third parties |
| A-F8 | `HubRouter`'s dynamic `register` cannot be enumerated, and its handlers are not all resources | accept. A static `handlers satisfies Record<Frame["type"], Handler>`; each handler calls its real owner (resource, outbox, card store) |
| A-F9 | `PersistentSeed` has one caller, and async IndexedDB contradicts rendering in the select frame | accept. P6 covers the transcript tail only. Order: memory LRU (sync) first, then IndexedDB. The previous key's pixels stay non-actionable until the next key resolves (see P-F6). Board and projects seeds are dropped until measured |
| A-F10 | `SingleFlight<K,V>` has one new caller | accept. A `Map<string, Promise>` inside `sessionSummaryScanner.ts` |
| A-F11 | `RequestScheduler` is justified by fan-out that P4/P5 remove | accept. Re-measure after P4; ship only the per-machine lane cap if it is still needed (with S-F14's reservation rule) |
| A-F12 | `Headed<T>.read()` fits no caller | accept. `headSources: Record<HeadKind, () => Head>` on the hub (precedent: `setTranscriptHeadSource`) |
| A-F13 | Two producers of the row between P1 and P5 | accept, with the precedence rule as owner Q1. `normalizeTransientError` is deleted in a named phase |
| A-F14 | P4's keepalive heads need P5's publish path | accept. P4 carries daemon heads only; projects ride `machine.status` (A-F1) |
| A-F15 | The 8 s deadline belongs to no phase | accept. It is phased with the server-side join rule (S-F2), and never before P3's daemon single-flight |
| A-F16 | `src/client/src/sync/` is outside bob `writePaths` | accept. Add it to `writePaths` in the same change |
| A-F17 | Wrong paths in §3.2 | accept |

## Sync red-team lane (S)

| id | finding | verdict |
|---|---|---|
| S-F1 (P0) | A read answer can erase an applied event; a head can be stored without its payload | accept. The resource keeps today's arbitration as a named classifier: `readVerdict(read, appliedSince) → apply \| merge \| drop` (from `statusOrder.statusReadVerdict`); events for a key with no successful read are buffered (from `sessionController:474-490`); a head is recorded only with the payload it came with, and `headSeen` never clears "needs a read" on its own (from `revisionScope.markFresh`/`markUnfresh`). A unit test enumerates the three writers against each other |
| S-F2 | Abort against a shared flight is undefined | accept (with P-F3). A shared flight ends only when its last waiter leaves (ref-counted); a reader's deadline makes that reader leave and never cancels the work; the retry joins the running open. `shareInFlight` gains a join mode. The deadline for `messages`/`status` comes from the measured cold open |
| S-F3 | The P2 goal (cold first row ≤ 1.5 s) has no mechanism | accept. P2 serves the first tail page through the existing `messagesPassive` (file read, returns `head`, never creates a runtime, `piSessionService.ts:2767-2775`) and opens the runtime in parallel for `status` |
| S-F4 | The unread reconcile and archive-notification clear lose their owner between P3 and P4 | accept. The board read keeps an idempotent reconcile with no flush; §4.5 says so |
| S-F5 | `classify()` cannot be written from today's error shape | accept (A-F3). `HttpError` carries `code`; `classify` keys on the code, then on the status; a protocol 404 is `no-answer` |
| S-F6 | Resume and online become full re-reads, and the herd lands on unlock | accept. `wake()` is always a heads compare; a full read happens only on key change, fact clearing, epoch change or a moved head; one pending attempt per resource |
| S-F7 | The transcript head misses in-place growth | accept. The transcript head is `{epoch, seq, n, leaf}`; a seed is confirmed only when the stream position is current |
| S-F8 | The row has no visibility policy, and "reconnecting" lies about permanent failures | accept the policy (with P-F1/P-F2); owner Q9 for how a repeating server error reads |
| S-F9 | The boot budget of 8 or fewer `/api` reads has no mechanism | accept. A batched boot read (config, machines, projects, statuses, pins, interrupted) in P4, with background reads counted in the budget |
| S-F10 | An unopened workspace's panel has no event source | accept. Every panel keeps a head and verifies it every *T* (4 a minute per open panel, inside the budget) |
| S-F11 | Effectful reads (read-and-clear) break under retry | accept. The spec names `effect: "read-and-clear"`: no client retry of a spent record; the unread contract is restated |
| S-F12 | Heads need a namespace, or a reset fools the compare | accept. Every head is `{namespace, value}`, where the namespace is the writer's instance id and the global scope gets an epoch |
| S-F13 | The board payload is not measured against the byte budget | accept. Measure on the real store before P4; per-project revisions echoed, so a moved head re-reads only what moved |
| S-F14 | "Critical never waits behind background" cannot be enforced | accept (A-F11). Background takes at most 2 slots, so critical always has 2 |
| S-F15 | The I11 grep test cannot pass while notices still use the regex | accept. Scope it to the read surfaces; notices get typed through the existing `RetiredBy` |
| S-F16 | `publishChange` crosses a boundary | accept (A-F1). The contract lives in `shared/`, the implementation on the daemon hub; publishing goes through the daemon |
| S-F17 | Re-sorting on every frame moves rows under the finger | owner Q7 |
| S-F18 | A route that names a session lacks the `cwd` | accept. The app writes `cwd` into links it makes; without it, the open falls back to the chain |

## Product lane (P)

| id | finding | verdict |
|---|---|---|
| P-F1 | The row flickers on every retry | accept. The row shows while no answer has arrived since the first miss (a sub-state that stays through retries), after the 4 s grace, and hides only after an answer plus the minimum visible time. A probe counts row mounts over 30 s of injected loss |
| P-F2 | The row's expiry, dismiss and shared slot conflict with a state-driven row | accept: the reconnecting claim has no expiry and no dismiss. Precedence against a real notice is owner Q1 |
| P-F3 | An 8 s abort can livelock a 24 s cold open | accept (S-F2). A reader's deadline never cancels shared work |
| P-F4 | "Syncing never visible" collides with D8's tap feedback and the "Loading…" titles | owner Q2 |
| P-F5 | The row's wording drops the machine name, and time-to-row is 12 s | accept. A typed cause `link-down \| machine-unanswering(machineId) \| daemon-restarting` with a wording table; small critical reads get a 3 s deadline; the budget becomes deadline + grace |
| P-F6 | An async seed paints blank frames | accept (A-F9) |
| P-F7 | Full-screen overlays hide the row | accept. The row renders above the dialog layer |
| P-F8 | Seed → read needs an anchor rule | accept. D4's `bottomAnchorAction` executes it, and the P6 probe asserts the scroll position |
| P-F9 | The projects seed is speculative | accept (A-F9) |
| P-F10 | A comment will lie after P1 | accept. It is on P1's delete list |

## Found during the live runs (not from a lane)

- **Daemon startup.** The 8505 daemon listened 31.4 s after its plugins activated, with nothing logged between them (restart during the B33 MCP run, 12:07:53 → 12:08:25Z). After every update restart, that is dead time. It goes into P3: instrument the startup phases, then fix the slowest.
- **Workspace-change storm.** A storm of workspace-change refreshes (git status and tree, about 3 per second) reproduced once on 8505 and makes up 86 % of 8504 traffic. P3's watcher filter.
