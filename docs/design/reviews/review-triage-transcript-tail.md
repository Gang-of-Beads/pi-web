# Review triage: P2 slice c (show the transcript without waiting for the runtime)

Review run 3ebf2c11 had two lanes on the reviewer shell, using the ponytail and bob lenses. Brief: `/tmp/p2c-review-task.md`.
- **Opus 5.5:** focused on ordering, page equivalence, prefix ids and refresh semantics. Verdict: OK with notes.
- **DeepSeek 4.1 max:** a full pass. Verdict: OK with notes, one P1.

I checked every claim against the source, and the SDK's own `session-manager.js`, before fixing it.

## Findings

| id | lane | finding | verdict | action |
|---|---|---|---|---|
| DS-1 (P1) | DeepSeek | A failed status read became invisible whenever a status was already known. The failure surface renders `statusReadFailed` only without a status, and `selectSession` seeds the status from the catalog. Before the change, the same failure raised the app notice (through the refresh rejecting) | true: a regression from visible to silent | The failure raises the app notice with the server's reason, as before, and still does not call the transcript failed. The test seeds a known status and asserts the notice. Mutation-checked |
| O-1 / DS-2 | both | The tail and `messagesPassive` looked up an open runtime by the whole id alone. Every other runtime read uses `activeForRef` (cwd, and the start of an id). A prefix ref missed an open, streaming session: it read the file on its leaf (a rewind without a summary is not persisted) and lost the partial | true | `activeForRef` in both. Test: a prefix ref to an open session answers from memory with its partial, against a real file that would answer without one. Mutation-checked (the first version of the test was masked by the runtime fallback and was corrected) |
| O-2 / DS-3 | both | A pre-v3 file: v1 has no ids, so the tail paged nothing, and v2 misses the role rename. The SDK migrates on open and rewrites the file in place, so a read beside that open can see it half written. `messagesPassive` regressed for v1 | true, proven from the SDK source (every local file is v3) | The tail reads a file directly only when its header says the current version (`isCurrentVersionFile`, `CURRENT_SESSION_VERSION`); otherwise it takes the runtime path. `messagesPassive` parses with the SDK's `parseSessionEntries` and migrates in memory with `migrateSessionEntries`. Tests: a v2 file goes through the runtime; a v1 file pages through the port; an SDK-truth test compares `branchFromFileEntries` with `SessionManager.open(path).getBranch()` on a branched v3 file. Mutation-checked |
| DS-3b | DeepSeek | A last entry without an id makes the SDK's branch empty, while the tail pages up to the last entry with an id | true, but unreachable: a v3 entry always has an id | Not matched |
| O-3 | Opus | The "position before read" test does not test the order | true | Renamed to what it proves (the stamp's session key). The order is argued, and DeepSeek's hunt 1 confirms it is sound; making it testable would need an injected file reader for one line |
| O-4 | Opus | Live frames buffered during a cold open wait for the status read | true, a delay only; frames stay in order | Not changed. A session streaming as it opens has a warm runtime, and then the status read takes about 3 ms |
| O-5 / DS hunt 6 | both | An older daemon costs one extra 404 per open, and its legacy reads now start after that probe | true | Accepted for the one-release window |
| DS-4 | DeepSeek | `statusReadFailed` outlived a newer status that arrived by a frame | true | Cleared at `applyStatus`, the seam every status passes through; tested |
| DS-5 | DeepSeek | `transcriptLoadingAfter(readSettled)` is constant under the guard just above it | true | Kept: it states the ownership rule where the flag is cleared |
| DS-6 | DeepSeek | Object-model line citations pointed at the wrong lines | true | Replaced with symbol names |
| DS-7 | DeepSeek | The latency probe is red by design and did not say so | true | The budget leg now says it is open, and why |
| DS-8 | DeepSeek | The test support defaults to the legacy path, and the tail path had no test for its partial | true | Kept the default (the honest older-daemon shape). Added a tail-path test that seeds the partial |
| DS-9 | DeepSeek | A refresh test used a tuned 5-microtask wait | true | `vi.waitFor` |

## Verification

- **Tests:** see the object-model entry. Suite 4850 (client, server and shared) passed; tsc and eslint clean.
- **Mutants killed:** the status gate, a status failure failing the transcript, silence without the notice, a stale flag, the version gate, passive not migrated, the tail paging every entry, the prefix lookup.
- **8505 after the rebuild**, daemon-cold, 3 runs each (`probe-open-latency.mjs`):

  | build | first row | status | row before status |
  |---|---|---|---|
  | before | 2.68 / 3.12 / 4.42 s | 2.60 / 3.02 / 4.31 s | never |
  | tail | 2.03 / 2.08 / 2.11 s | 2.73 / 3.05 / 2.65 s | always |
  | tail + review fixes | 2.33 / 2.20 / 2.06 s | 3.24 / 3.24 / 2.64 s | always |

  The ≤1.5 s budget is still open. A request timeline shows why: the board's cold `sessions?cwd=` listings hold all six HTTP/1.1 connections for about 1.1 s, and the browser plugin modules the route restore waits for queue behind them (queued at 218 ms, sent at 1294 ms, served in 1–5 ms). That is the next slice.
- **Regression probes:** `probe-session-gone` 17/17, `probe-board-heals` 9/9, `probe-read-heals` 8/8.
