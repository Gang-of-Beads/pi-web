# Review triage: wave C4 (message status in the row, deleted pins, sends to a deleted session)

- **Commits:**
  - `b469d48b`: a sent message's unanswered status speaks through the app's one row (P1 slice 6).
  - `4caabf4e`: unpin a pinned session the machine answers gone.
  - `2cab8472`: say a send's session no longer exists.
- **Lanes:** two reviewers read a frozen worktree (`/tmp/pw-c4`) with the bob and ponytail lenses. Workflow `9ea5b2c7`.
  - Opus 5.5: OK with notes, one P1.
  - DeepSeek 4.1 max: OK with notes, the same P1.

Each finding was settled by reading the source. Each fixed finding with a behavior change has a test that fails on `2cab8472`.

## Fixed

| Lane | Finding | Verdict | Fix |
|---|---|---|---|
| Both, P1 | `4caabf4e` unpins live sessions. The board's locate starts from the home directory, and `findSession` searches only the home directory's resolved store, an absolute env store and the default root (`piSessionManagerGateway.ts:111-118`). A project whose settings keep its sessions in a directory of its own is invisible from there. A pinned session of a closed project, the very case B49 exists for, reads gone, and its pin was destroyed. | **True.** | The board unpins nothing. The web process unpins the ids its daemon's answer to PI WEB's own delete names as deleted: bulk delete-archived and cleanup, the only proofs of deletion it sees (`registerSessionProxyRoutes` hooks, `sessionProxyRoutes.deletedUnpins.test.ts`). A remote machine's delete is forwarded to that machine's web process (`federatedRoutes.ts`), which unpins in its own store. A session deleted with the pi CLI or by hand keeps an undrawn pin until a locate can prove it gone (B49 pin kinds). `probe-deleted-pin`: the board answers the fixture gone and its pin stays; PI WEB's delete removes its session's pin. |
| Both, P2 | Shell lines and commands added the daemon's raw "Session not found" to the transcript and to the command row while the notice said the new sentence. | **True.** | `sendRefusalWords` gives the line and the row the same words as the notice. A shell line's and a command's words are not handed back (`send()` treats them as handled), so the changeset now promises that for messages only. |
| Opus, P2 | A stale `since`: leaving a session left its claim in state until that session's next timed ask, so coming back before then showed "Reconnecting…" at once, counted from before, skipping the grace. | **True.** | Leaving a session ends the episode: `PiWebApp.setState` drops a claim that is not about the chat now on screen. Test: "ends with the episode…". |
| DeepSeek, P2 | The row could read "Reconnecting…" for up to one ask after a later send to the same session was answered. | **True** (DeepSeek judged it acceptable; changed anyway). An answered send is an answer from that session's machine. | `settleAnsweredSend` withdraws the session's claim. Test: "is withdrawn when a later send to the same session is answered…". |
| Both, ponytail | The keep-the-first-`since` decision was written twice; `ours` was not a type predicate; `nothing-open` and `answered` behaved identically. | **True.** | `claimAfterMiss` and `isClaimOf` in `sendVerification.ts`, unit-tested; one claim path in the controller; `LedgerAsk` is `answered` or `unreachable`. |

## Not fixed, with reason

| Lane | Finding | Verdict | Reason |
|---|---|---|---|
| Opus, P2 | "No longer exists" rests on a one-directory lookup. | True, narrow. | A send's not-found comes from the session's own store, read through the session's own cwd (`getActive` → `resolveSessionFile(ref.cwd)`), so it is an answer about that session. Archived sessions open from the archive and never answer not-found. Only a session moved to another store by a changed `sessionDir` reads gone wrongly. Sending the page through the machine-wide locate instead would drop the reader's words into a draft of a gone session. Recorded in `sessionNotFound.ts` and D1. |
| Opus, P2 | `ledgerUnreachable` lets only network errors through, so the machine and server branches of the row are dead, and a gateway 502 stops the chain. | **False.** | `ledgerUnreachable` counts every `HttpError` with status 0 or ≥ 500 as unreachable (`sessionController.ts:219-222`), and `classifyReadError` maps a remote gateway's 502 to machine-unanswering and a local 500 to server-error. The chain keeps asking through both. |
| Opus, P2 | A send whose bytes never left now has no notice; a pending-start send flushed to a session the reader left has neither a row nor a claim. | True; by design for the first, recorded for the second. | The first one's row reads "Not sent" with Retry, which is the one place it speaks (DeepSeek confirmed). The second sends to a session not on screen, and its words stay in that session's outbox. Whether a background failure should speak is a product question, recorded for the owner. |
| Opus, P2 (pre-existing) | `ensureMachinePins` re-adopts a device's local pins on every fresh load, so a stale device can bring a removed pin back. | True, pre-existing. | Recorded under B49 pin kinds: adopt once per device. A re-adopted deleted pin is never drawn. |
| DeepSeek, P2 note | `app.ts`'s async wrapper around `unpin`. | Obsolete. | The wrapper is gone with the board's unpin. |

## Found while gating: real-model spend in the probes

Rerunning the deleted-pin probe showed that a session it created had run on the machine's default model (`anthropic/claude-opus-5`), with a tool call that wrote `session.txt` into the seed workspace (removed).

- The seed sessions `…c1`, `…d1` and `…e1`, which `probe-inbox-order`, `probe-queue-restart` and eight other probes prompt, were on real models.
- The transcripts' list-price estimate is about $82 since 2026-08-28: $5.20 on 2026-10-01 and $31 on 2026-09-29.
- **Stopped:**
  - The three seed sessions now run on the zero-cost fixture model (`pi-web-probe/flaky`). A probe that prompts them without its fixture server now fails loudly instead of spending.
  - `probe-deleted-pin`, `probe-message-status-row` and `probe-custom-screen` select the fixture model before they prompt.
  - The probes that need a real tool-running turn (`probe-inbox-order`, `probe-queue-restart`) move to a fixture server that streams a tool call (maintenance).

## Follow-up commit
- Tests that fail on `2cab8472`: `sessionProxyRoutes.deletedUnpins.test.ts` (2), the claim tests in `sessionController.sendVerification.test.ts`, `PiWebApp.messageStatusRow.test.ts` and `sendVerification.test.ts`, and the shell and command lines in `sessionController.sendFailure.test.ts`.
- **Mutants:** all eight killed.
  - NA: no unpin.
  - NB: unpin on a refused delete.
  - NC: cleanup not hooked.
  - ND: raw words in the command row.
  - NE: an answered send keeps the claim.
  - NF: leaving keeps the claim.
  - NG: `since` resets on every miss.
  - NH: a claim matched by session only.
  - ND first survived. The command row's text had no assertion; the shell and command test now pins it.
- **Probes on 8505:** `probe-deleted-pin`, `probe-send-to-deleted`, `probe-message-status-row`, `probe-pin-outlives-project` and `probe-pins-live`. Results are in the commit gate.
- Restart: the web process (pins), and reload the page.
