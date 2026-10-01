# Review triage: O-P9, the session board takes its machine's announcements

Review run `ece619f0`, two lanes on `reviewer`, reading a frozen worktree at commit `42f7c8b1`:

- **Opus 5.5:** OK with notes.
- **DeepSeek 4.1 flash max:** OK with notes. No P0 and no P1.

Each finding was checked against the source before triage.

| # | Finding | Lane | Verdict | Action |
|---|---|---|---|---|
| 1 | A replayed `session.created` overwrites the newer row a read returned. The event is the session as it was at creation: no first message, no count, often `persisted: false`. The daemon publishes it once, so a row already listed under its id only meets it again on a replay, and the replay makes the row older. | O-F1, D-3 | **True.** | **Fixed.** A session the board already lists keeps its row; the announcement only adds one that is missing. It is still a set. Test: "keeps the row a read holds when the creation of that session is announced again". Mutant QA killed. |
| 2 | A refused rename keeps the refused name on the board. Before O-P9, a read in flight would overwrite it; now the replay keeps it over that answer. The selection takes the old name back on refusal, so the two lists disagree. | O-F2, D-2 | **True.** | **Fixed.** `renameSession` returns whether the machine took the name. When it refused, `renameListedSession` takes the old name back on the board through the same change, which a read in flight then also replays. The quick switcher's rename goes through the same path. Test covers both outcomes. Mutant QB killed. |
| 3 | Two rename reducers: `renameSessionInList` stores `name: ""`, while `boardWithEvent` deletes the name. | O-F3 | **True.** | **Fixed.** The board's own rename is the announcement's change (`applyEvent` with `session.name`), so there is one reducer. |
| 4 | A fork or a clone made on one device never joins another device's board until its next whole read. They replace the runtime with a new id without going through the start path, which is the one place that publishes `session.created`, and they publish only `session.name` for an id no board lists. | D-1 | **True.** This is another producer of the symptom O-P9 set out to remove. | **Fixed at the source.** `sessionCommandService` announces `session.created` after a fork or a clone that was not cancelled. It is published after the name, so the row carries it. Tests: the fork and clone tests assert the global announcements in order. Mutants QC and QD killed. **Daemon restart needed.** |

## Hunt items (both lanes)

1. **Idempotence:** every change passed to `update` is a set. Two ordered renames replay in order. A rename lost on the socket can stick until the next read, but nothing worse.
2. **The created event:** an unwritten session that joined the board leaves at the next whole read, because `list()` builds rows from files. The board's ancestor rule matches the daemon listing's equal-or-inside rule.
3. **Machine scope:** each socket carries its machine id in its connect closure. An old socket is closed and its handler cleared on switch, so the scope is sound.
4. **`sinceRead`:** it is bounded by one read in flight, which has a deadline. It is cleared when a read starts. Clearing it on a miss would change nothing.
5. **Owner rules:** a pure reducer, no inline comments, no assertions, and the design is recorded.
