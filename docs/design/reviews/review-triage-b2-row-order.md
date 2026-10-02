# Review triage: B2, every waiting message placed by its state

Commit `f913afd9` ("Place every waiting message by its state, so none is drawn out of order (B2)"). Review run `1b6f1553`, two read-only lanes on the frozen worktree `/tmp/pw-b2`:

- Opus (`anthropic/claude-opus-5-5:medium`): OK with notes, no P0 or P1.
- DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`): OK with notes, no P0 or P1.

Every claim below was checked against the source before it was triaged.

## Fixed

| # | Finding | Lanes | Verdict | Fix |
|---|---|---|---|---|
| 1 | A command row issued after the last settled message is drawn before the whole pending block, so a command typed after a waiting message stood above it. Already true for queued rows; the commit widened it to sending, unverifiable and failed rows. | Opus 1a, DeepSeek P2-1 | TRUE (`ChatView.ts:1249-1250`, `commandPlacement.ts:30-37`); measured live on the build before the follow-up: `/session` typed after two waiting messages was drawn at row 1, above both | `renderPendingMessages` places the tail commands among the waiting messages by issue time with `placeCommands`, the rule the settled groups already use. |
| 2 | A committed copy replaces the bubble it claims in place, so a failed message retried after more conversation jumps back above the replies since its first try; a reload draws it at the end, where pi wrote it. Before the commit the failed row sat at that stale slot the whole time. | Opus 2a | TRUE (`chatTranscript.ts:144`) | A copy that claims a bubble still open (waiting, an echo) or a failed one retried lands at the end. Pinned by `chatTranscript.test.ts`. Not reproduced live: a cut send stays unverifiable through the turn, which keeps the tail, so the jump does not form in the probe's flow. |
| 3 | The register's row `state` has no production reader after the commit, while placement re-derives the same fact from the queue list with a copied identity rule. | DeepSeek note | TRUE (`userMessageRegister.ts:29-38`) | The register carries the queue position on the row; placement reads only the rows, and `queuedIdentity` is private again. |
| 4 | The rank table told "accepted but not listed" apart from "being sent", a distinction D1 does not draw; a mutant flattening it survived. | DeepSeek P2-3 | TRUE | Placement is D1's rule: what the daemon lists first, in its order, then every other waiting message by send time. One table says which states are waiting. |
| 5 | `compareKeys` carried an unreachable `?? 0`; `delivered` was tested beside the table. | Opus 7 | TRUE, nits | The key is a two-number tuple compared field by field; `delivered` is a table entry. |

## Not fixed, with reason

| # | Finding | Lanes | Verdict | Reason |
|---|---|---|---|---|
| 6 | Settled rows are numbered by their position in the settled list (`chatGroups.ts:27`); a row crossing between settled and pending shifts every later row's anchor id, copy highlight and info-panel key by one. | Opus 1b, DeepSeek P2-2 | TRUE, pre-existing for queued rows | Keying rows by identity instead of position is a change to grouping, scroll memory and every per-row key; recorded as a maintenance item. The visible effect is a copy highlight or open info panel moving one row, only when a row exists after a waiting one. |
| 7 | A row moving between the settled list and the pending block is not corrected by the reading anchor, so a reader scrolled above it can see a small jump. | DeepSeek P2-4 | TRUE, pre-existing for queued rows | The anchor arms only for content above changing through paging; widening it is the same per-row identity work as #6. |
| 8 | A message consumed by an input handler has no committed copy, so it stays "received" and now sits under later messages until a reload; D1 says a consumed message leaves no row. | Opus 3a | TRUE (conditional), pre-existing | The browser has no "consumed" fact to act on; the daemon would have to report it. Recorded with B3/B4. |
| 9 | `withQueuedAnswers` inserts an answer before the first pending row sent later, which assumes the block is in time order; the daemon's order comes first, so an answer can sit above a message sent before it that the daemon does not list. | Opus 5 | TRUE, edge | Inherent to D1's order (listed first, in the daemon's order); the agent reads the listed messages first. No order satisfies both. |
| 10 | `splitTranscriptAndPending` is no longer called by production code but still pins about twenty test cases with its own identity scheme. | DeepSeek note | TRUE, pre-existing | Deleting it means porting those cases to the register first; recorded as maintenance. |

## Judged not a defect

| # | Finding | Lanes | Verdict |
|---|---|---|---|
| 11 | The commit message says 2 of 3 new tests fail on the prior commit. | DeepSeek P2-3 | TRUE that it is stale: the third test's expectation was changed after the first run, and all three fail on the prior commit. The message cannot be amended without rewriting history; recorded here. |
| 12 | Any other producer places a waiting user message out of send order relative to another user message. | Both, hunt item 1 | FALSE. |
| 13 | A failed row is something the agent took. | Both, hunt item 2 | FALSE: a committed copy claimed by id turns it delivered. |
| 14 | `queuedIdentity` changed behaviour. | Both, hunt item 6 | FALSE: the same expression. |
