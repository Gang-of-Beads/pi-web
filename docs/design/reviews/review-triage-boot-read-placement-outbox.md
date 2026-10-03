# Review triage: boot read, command placement, outbox replay

Review run `bd7a6a81`, two read-only lanes on the frozen worktree `/tmp/pw-b4` covering three commits:

- `2e831554` "Learn each session's latest activity from the boot status read (B14)"
- `5e14b56d` "Put a command after everything stamped before it (B2)"
- `d20de078` "Resend by itself only a message not sent in the last ten minutes (B4)"

Lanes: Opus (`anthropic/claude-opus-5-5:medium`) and DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`). Opus: boot read OK, command placement OK with notes (one P1), B4 OK with notes. DeepSeek: boot read OK with notes (one P1), command placement OK, B4 OK with notes. Every claim below was checked against the source before it was triaged.

## Fixed

| # | Finding | Lanes | Verdict | Fix |
|---|---|---|---|---|
| 1 | The boot read teaches only a session the page knows no activity for. A page that holds an idle for a session, loses its socket while that session fails, and reconnects (`hydrateSessionStatuses` with `replaceKnown`) keeps the idle: the Go to page and the switcher say "Session is done" for a failed session until a reload. | DeepSeek F6 (P1) | TRUE (`activityAfterStatus.ts` `statusActivityToAdopt`) | A status's activity replaces the one the page holds when it is stamped later; both stamps are the daemon's. A frame as new or newer stays. Commit `boot read, newer activity wins`. |
| 2 | D1's "known limit" said the ledger's "not received" answer misses the outbox record; `closeUnverifiedOperations` writes it (`failPendingPrompt`), so within the window such a record goes by itself. | Opus, DeepSeek F1 | TRUE (`sessionController.ts:2596`, `pendingOutbox.ts:356-367`) | D1, the module header and the replay docstring corrected; the replay table pins the case. `4ba01479`. |
| 3 | A message kept for its own session (the reader switched sessions before it was handed over) stays without a state: past ten minutes it no longer goes by itself, reads "Receiving..." in the tray and carries no session-list mark. | Opus, DeepSeek F3 | TRUE (`PromptEditor.ts` `keepForItsSession`, `pendingPromptActions.ts:35-38`, `pendingOutbox.ts:209`) | It is marked not sent at once, so words, mark and replay agree. `4ba01479`. |
| 4 | A record whose send time cannot be read is hidden from the tray (the age filter is false for NaN) and re-arms the reveal timer on every render. | DeepSeek F5 | TRUE (`PromptEditor.ts:631`) | Shown. `4ba01479`. |
| 5 | The D1 note on `takeBackHeldMessages` named only the idle path and not the forced steer lane. | Opus | TRUE (`piSessionService.ts:3720-3734`, `4471`, `4940-4944`) | The note names the three callers and the steer lane. `4ba01479`. |

## Not fixed, with reason

| # | Finding | Lanes | Verdict | Reason |
|---|---|---|---|---|
| 6 | Command placement by timestamp fails whichever way it reads the stamps: "before the first group stamped later" put a command typed during a bash run above that run (the group carries the time it ended); "after the last group stamped at or before it" puts a command below later rows when a group late in the order carries an early stamp: a retried message keeps its first send time, the pending block is ordered by the daemon's queue first, and a slow phone clock is clamped only from above. | Opus P1; DeepSeek judged the new rule bounded | TRUE | Both rules patch a model that cannot hold: transcript stamps do not rise. The fix is causal: a command row anchored to the rows present when it was issued. That changes the placement model, so it is designed in D1 first and recorded in CHECKLIST under B2; the reproduced case (a command typed during a tool run) stays fixed meanwhile, and the reverse case needs a command issued between a message's first try and its retry. |
| 7 | A record written by a pre-phase-5 build (`stored`, read as `sending`) is no longer resent by itself. | DeepSeek F2 | TRUE | Such a record is weeks old, past the window under any reading of its state; it is offered Retry and Discard. |
| 8 | The window is measured from the record's first send time, which a Retry does not renew, so a just-retried old message whose retry fails is not continued on `online`. | DeepSeek F4 | TRUE | D1's rule as written ("made on this device within the last 10 minutes"); the reader pressed Retry once and is offered it again. |
| 9 | Adoption also runs on the reconnect and switcher-open reads, not only at boot. | Opus note | TRUE | Intended; D3 calls the boot read by its first use. |

## Judged not a defect

| # | Finding | Lanes | Verdict |
|---|---|---|---|
| 10 | An adopted catalog activity can be older than a frame applied during the read. | Both | FALSE: `keeps` protects frames applied while the read was in flight. |
| 11 | The selected session's map entry and the dock's activity disagree because of the boot read. | Both | FALSE: the selected session learns only from its own status read, which sets both. |
| 12 | Another path resends outbox records outside `replaysRecord`. | Both | FALSE. |

## Found while verifying

- B32 (streamed text not shown until the turn ends) is real on a real provider: with `github-copilot/claude-haiku-4.5` every text delta reached the daemon in the same millisecond, 2 ms before the run ended. The pi CLI shows the same batching with the owner's extensions loaded and streams normally with `--no-extensions`, so one extension holds pi's events; see D1 and CHECKLIST B32.
