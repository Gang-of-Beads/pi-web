# Review triage: P3 slice d, reading a closed session never opens it

Review run `b26f21fb`, two lanes on the builtin `reviewer`:

- Opus 5.5: `review/p3d-opus.md`
- DeepSeek 4.1 max: `review/p3d-deepseek.md`

Both lanes gave "OK with notes" and found no P0 or P1. Each finding is marked fixed, not fixed with the reason, or judged not true. The design is in state-diagram D5, "Reading a closed session never opens it".

## Measured

`probe-closed-reads.mjs` runs on 8505 at 393×850:

- **Archived copy opened by link:** on HEAD (`a8b6dc3c`) it appeared in the daemon's runtime catalogue, so a runtime had been opened (5/6). After the change it opens no runtime and shows no startup notice (6/6).
- **Control:** a closed live copy's status read still opens its runtime.

## Findings

| # | Lane | Finding | Verdict | What changed |
|---|---|---|---|---|
| Opus-1 / DS-2 | both, P2 | A read that lands while the runtime is closing can miss the close's last entries. `active.delete` runs before `keepWhatThePiHolds` and `abortStampingCommits`, which can still append steers the runtime took back and the aborted reply. | **True, fixed** | `closedSessionFile` waits for the session's close lock before it resolves the file. The close then answers with the file the close finished writing, instead of reopening the runtime, which was the old path's behaviour and itself a bug. DS-2 proposed falling through to `getOrOpen`; I didn't take that, because it would reopen a session the reader just stopped. Test: a held `dispose` keeps the close running, and the read stays pending for 150 ms, then answers once the close ends. The first version of this test waited only microtask turns, and a real file read takes longer than that, so the mutation check caught it as vacuous. |
| Opus-4 / DS-3 | both, P2 | The two changed tests no longer told the file path from the runtime path. The listing-freshness test lost the "opens" proof it was written for, and both kept dead canned branches and an inline comment. | **True, fixed** | `closedReads.test.ts` gains an open runtime whose branch differs from its file; the page comes from the runtime and exactly one open is counted. It also gains an archived record with no `archivePath`, which reads the session file. The listing-freshness test reads the page, then opens through `status()` and asserts the file it opened. The dead `getBranch` fakes are removed. The inline comment is now a docstring. |
| DS-1 | DeepSeek P2 | The slice shipped no changeset and no daemon-restart note. | **True, fixed** | `.changeset/closed-sessions-read-from-file.md` is added, and it names the restart. |
| DS-4 | DeepSeek P2 | D5 did not mention the close window or name its probe. | **True, fixed** | Two bullets are added: the close wait, and the probe with its control. |
| Opus-2 | Opus P2 | An archive racing a closed read can still open the archived runtime: the original file is removed before the record is written, so the read falls through to `getOrOpen`. | **True, recorded, not fixed** | This already existed before the change, and the window is narrow. |
| Opus-3 | Opus P2 | A read beside an open that is migrating the file can see a version-3 header with truncated lines. | **Judged not true for a partial header, recorded for truncated lines** | A partial header fails `isCurrentVersionFile` and falls back to the runtime (DS hunt 1). Truncated tail lines were already accepted for the tail read in P2 slice c, and the next read heals them. |
| Opus-5 / DS-5 | both, P2 | Each closed read parses the archive store once more, without a memo. | **True, report only** | This is not a regression, since `getActive` already read it. It costs far less than the open it replaces. A memo becomes worth it if the store grows to hundreds of records. |
| DS smaller shape | DeepSeek | Collapse `closedSessionFile` plus `closedBranch` into one helper. | **Judged not smaller** | The three readers need different parts. The tail needs the file id for its stream position, the page needs the branch, and the background tasks need only the path. Reading entries for the background tasks would parse a 17.8 MB file to learn its name. |

## Mutation checks

Each branch below is killed by at least one test:

- the background tasks read from the closed file;
- the page from the closed file;
- archive-first file resolution;
- the current-version gate;
- the close wait;
- the open runtime's precedence over the file;
- an archived record without an archive path.
