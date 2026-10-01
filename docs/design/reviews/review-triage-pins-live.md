# Review triage: P5 slice a, pins are live from an event

Review run `7081eece`, two lanes on `reviewer`:
- **Opus 5.5:** OK with notes. Two must-fix-before-release findings.
- **DeepSeek 4.1 flash max:** BLOCK on two P1s.

Both lanes found the same two P1s on their own. Each finding was checked against the source before triage.

| # | Finding | Lanes | Verdict | Action |
|---|---|---|---|---|
| 1 | A `pins.changed` that arrives while a read is on its way is dropped (`ensureMachinePins` returns on `pinReadsInFlight`). The older answer is then stamped current, and nothing reads again. | O1, D-F1 | **True** (read `PiWebApp.ts:526-552`). It breaks the D5 rule "a read on an edge never trusts a read already on its way". `RunsRead.readAgain` and `sessionUnread.refreshAgain` already follow that rule. | **Fixed.** `pinsReadAt` (a timestamp nothing reads) is replaced by `pinsStale: Set`. A refresh marks the machine stale, and a read clears the mark when it starts. If the mark is back when the read ends, one more read follows, so a burst during a read costs one read. Test: "reads once more after a read that was on its way…" (two events during a held read: 1 read while held, 2 in total, and the second answer is shown). |
| 2 | A non-selected machine's activity socket reopens without reading pins, so changes missed while it was down stay missing. | O2, D-F2 | **True** (`PiWebApp.ts:2145-2149` only refreshes unread). Before this slice, the 2 s render re-read covered it. | **Fixed.** The activity socket's open handler calls `refreshMachinePins(machineId)`. A remote that comes back online gets a new activity socket, and its open handler now reads too. Test: the reopen test drives the real open callbacks through a stubbed `RealtimeSocket.connect`. |
| 3 | A tab resume refreshes only the selected machine's pins, but the quick switcher shows the browsed machine's pins. | O2, D-F3 | **True** (`PiWebApp.ts:1365`). | **Fixed.** Resume refreshes every machine in `pinsAdopted`. These are the machines that answered once, which are the ones whose pins are on show. Same test, resume leg. |
| 4 | A write that changed nothing still announces, and every page load with pins in local storage adopts. So each reload costs every open tab on the machine one read. | O3, D-F6 | **True.** Not a storm, but it is waste. | **Fixed in the store, not the route.** `SessionPinStore` takes an `onChange` listener and calls it only when the set changed, decided inside its serialised tail. A before/after check in the route would race a concurrent write between `list()` and the write: an unpin from another device and a re-pin from this one would compare equal, and a change would go unannounced. The route goes back to its original signature, and `app.ts` gives the store the nudge. Test: a repeated pin, a repeated adopt and an unpin of an unpinned id announce nothing (3 announcements in total). |
| 5 | A remote machine's pins are not federated. `/session-pins` is not in `FEDERATED_HTTP_ROUTES`, so on a gateway the read gets the SPA fallback and fails to parse, and a selected remote is read again on every render. | O4, D-F5 | **True, and older than this slice.** Not caused by this change, but the docs overclaimed. | **Docs scoped here; the fix is the next slice (P5b).** It needs `GET` and `POST /session-pins` in `FEDERATED_HTTP_ROUTES`, plus `sessionPinsApi` in the federated contract test. State-diagram D5, object-model §1.14 and the changeset now say "the machine that serves the page". |
| 6 | Stale text: an orphan docstring above `@customElement`, and object-model §1.14 still described the 2 s render re-read as current. | O5, D-F4 | **True.** | **Fixed.** The docstring is deleted, and §1.14 "Read" is rewritten as before and since, with what is still to do. |
| 7 | The "reopen" test leg called `refreshMachinePins` directly, so removing the wiring would not fail it. | O6, D-F2 note | **True.** | **Fixed.** The leg is renamed to what it does ("afterRefresh"). A new test drives the activity socket's real open callback and the real `refreshAfterBrowserResume`. |
| 7b | (Found by the existing test while row 1 was being fixed.) Clearing the stale mark when a read starts dropped the old retry after a failed read, so a machine whose read failed was never read again until the next event. | test | **True.** | **Fixed.** A failed read marks the machine stale again, so the next render retries it, as it did before. The mutant that removes this (MJ) is killed. |
| 8 | The daemon's `{ published: kind }` reply is never read, `nudgeChange` has no abort signal, and `changePin` could be inlined. | D hunt 5 notes | **True, harmless.** The nudge is fire-and-forget and the write has already answered. The reply body is for logs and tests. | **Not fixed.** These are reported only and do not affect behaviour. |

Mutation: MA (no announcement), MB (stale re-read), MC (event ignored), MD/MF (no trailing read), ME (daemon takes any kind), MG (activity reopen), MH (resume selected only), MI (store announces always), MJ (failure not stale) and MA2 (store silent) are all killed.

## Hunt items

- **Ordering:** true, fixed (row 1).
- **Missed updates:** true for socket reopen, resume and in-flight reads, all fixed (rows 1–3).
  - A daemon restart on the selected machine was already covered: `webSocketBridge` closes the browser socket, so it reopens and reads.
- **Load:** no storm. The no-op announcements were waste and are fixed (row 4).
- **Federation:** true and older than this slice. Next slice (row 5).
- **Owner rules:** both lanes found nothing wrong.
  - Placement by process is correct.
  - The classifier and table shape is correct.
  - There are no type assertions in production code.
