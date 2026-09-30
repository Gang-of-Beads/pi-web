# Review triage: live surfaces P1 slice 5 (the session board never gives up)

Run 3eeecb09, two lanes on the reviewer shell:
- Opus 5.5, focused on scope, cost against the 8504 load budget, and the resource change;
- DeepSeek 4.1 max, a full pass.

Both used the ponytail and bob lenses. Brief: `/tmp/p1s5-review-task.md`. Both returned **OK with notes**, with no P0 or P1.

Both lanes also reviewed a tree that moved while they read: the gap-only retry below was added mid-review, after I found its cost myself. Each claim was checked against the source before it was fixed.

## Found before and during review (by me)

| id | finding | fix and proof |
|---|---|---|
| S-1 | A partial board's retry re-read every source. On 8504 each sessions listing is a whole-store scan on the daemon, so one workspace that never answered would re-read the whole board every 15 s, indefinitely | A retry asks only the unknown sources (`completeSessionBoard`); a whole read happens when the reader forces one, or when the board is more than 30 s old. Tests "asks only the sources that did not answer" and "fills a partial board by asking only the source that did not answer"; both mutation-checked. The probe's leg B counts other workspaces' session reads after the rows show and expects 0 |
| S-2 | Found live on 8505 (workspaces probe leg C, 12/13): the board was asked for twice at boot. The second `browse` marked the read in flight dirty, so a second whole read ran after the first, doubling the boot cost and widening the window in which a tap joins the board's in-flight read | `ScopedResource.join(key)` waits for the read in flight without asking for another, and a non-forced `browse` joins. Test "joins a read already in flight"; mutation-checked. Leg C now waits for the board's boot reads to go quiet before installing its interception |
| S-3 | A non-forced browse of a partial board read it whole, which, combined with the projects hook below, would cost a whole read per projects settle during boot | A board read whole within 30 s only has its gaps filled when browsed again. Test "only fills the gaps of a partial board read moments ago…"; mutation-checked |

## Fixed from the lanes

| id | lane | finding | fix and proof |
|---|---|---|---|
| O-P1 | Opus | A stated refusal (401/403) from one source became an unknown source and was asked again forever | `listed` rethrows a fact, so the board read becomes a fact and ends its retries. Test "stops reading a board once a source states a refusal"; mutation-checked |
| O-P2 | Opus | A whole read the reader asked for (after an archive) that got no answer was lost: the retry only filled gaps, and the archived row stayed | A failed whole read keeps the request for the retry. Test "keeps asking for a whole read when the one the reader asked for got no answer"; mutation-checked |
| DS-1 / DS-2 / O-P4 | both | The projects hook was `wake()`, which does nothing on a live board. A project added while the board is live did not reach it until it went stale, and a machine switch from the machine list left the old machine's rows under the new one (pre-existing, and a tap then asked the new machine for the old machine's session) | `followProjectsOnBoard`: once the selected machine's projects answer, the browsed machine's board is shown and browsed, which clears another machine's rows. A change in the same machine's project set reads it whole. A settle that changed nothing costs nothing. Two PiWebApp tests; both mutation-checked |
| O-P5 | Opus | Stale comments: one described the deleted `QUICK_SWITCHER_REFRESH_MS`, one described "loading" on `boardAnswer` | Removed. The first was part of a dangling doc comment left by an earlier deletion (DeepSeek DS-8 noticed it), and the whole dangling block went with it |
| O-P6 | Opus | Unknown sources were prefixed strings parsed with `startsWith` | A typed `UnknownSource` union |
| O-P7 | Opus | A redundant condition in the read branch | Rewritten as one branch |
| O-P8 / DS-6 | both | The probe did not check cost, and carried a dead field | A cost leg was added and the dead field removed |
| DS-7 | DeepSeek | The gap-only rule was only in a docstring | Written into object-model §1.5 |

## Not changed

| id | lane | finding | why |
|---|---|---|---|
| DS-3 | DeepSeek | A rename can be reverted until the next whole read by a gap-fill that was in flight when it happened | True and bounded: the daemon holds the new name, and the next whole read shows it. Closing it means merging with the entry at settle, which is not worth the code for a rename during a retry |
| DS-4 | DeepSeek | A source's refusal parks the board silently | By design: a fact ends retrying, and the same refusal shows its notice through the workspaces controller when a project is opened. Recorded in object-model §1.5 |
| DS-5 | DeepSeek | The archive's awaited forced read may not be the one carrying the archive | False. A `refresh` during a read in flight resolves after the dirty re-read that covers it (`scopedResource.ts` `finish` then `start` with the pending resolvers) |
| O-P3 | Opus | Returning to a partial machine read twice | Resolved by S-2: the browse joins the gap-fill that the watch started |
| hunt 1.1 | Opus | A machine switch from the header did not re-mirror | Resolved with DS-2 |

## Verification

- **Tests:** 20 new tests; 13 guards mutation-checked.
- **Probe** `scripts/probe-board-heals.mjs`, phone 393x850:
  - old build: 4/8, with "No sessions yet." on a machine with 142 sessions, and the lost workspace never returning;
  - new build: 9/9. A 6 s projects 500 heals at 7.3 s, and a lost workspace heals at 5.5 s, with 0 other workspaces' session reads after the rows show;
  - the slice 1-4 probes still pass (6/6, 10/10, 13/13, 8/8).
- **Full suite:** 5909 passed, 2 expected fail; knip and tsc clean.
