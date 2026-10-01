# Review triage: P5 slice b, a remote machine's pins go through the gateway

Review run `29749d0f` used two lanes on `reviewer`: Opus 5.5 and DeepSeek 4.1 flash max. Both returned **OK with notes**, and neither found a defect in the change. Each finding was checked against the source before triage.

| # | Finding | Lane | Verdict | Action |
|---|---|---|---|---|
| 1 | Nothing tests the gateway's own `/api/machines/local/session-pins`, and the new proxy route now competes with it. Lose or reorder the static mount, and the local machine's pins fall to the proxy, which answers 501, while the suite stays green. | D-F1 | **True.** | **Fixed.** The proxy test reads `/api/machines/local/session-pins`, expects 200, and checks that only the three remote calls were forwarded. Mutant MC (drop the local mount) is killed. |
| 2 | The `adopt` body through the proxy is unasserted. | O hunt 2 | **True** (only `{ sessionId, pinned }` was checked). | **Fixed.** The test posts `{ adopt: [...] }` and expects it to reach the remote unchanged. |
| 3 | The changeset reads as if an old remote is only slower. A remote older than "Pins belong to the machine" has no `/session-pins` and still fails. | D-F2 | **True.** | **Fixed.** The changeset now says that such a remote's pins still cannot be read or changed from here. |
| 4 | On an old remote, the read gets the app shell, fails to parse, and is retried on each render. | O-1, D hunt 4 | **True, as before this slice.** It does not loop by itself: a failed read asks for no render. | **Not fixed here.** The fix is for an unknown `/api/*` path to answer 404 instead of the shell. That is already in the maintenance backlog, and it only helps remotes upgraded from then on. |
| 5 | The probe registers 8505 as its own remote, so one daemon feeds both sockets. It cannot prove that one machine's event is never credited to another, and it does not cover a selected remote's main socket. | O-2, D note | **True.** | **Recorded** in the probe's docstring. Both paths are unit-tested (`PiWebApp.pinsLive.test.ts`), and the proxy test proves that the remote path is forwarded. A two-machine check needs a second stack. |
| 6 | The probe is tied to the 8505 stack, and unpins its session on 8505's own store. | O-3 | **True.** | **Recorded** in the docstring ("for the 8505 test stack only"). |
| 7 | The probe file was untracked. | D note | **True.** | It is committed with the slice. |

Mutation: MA (no GET route), MB (no POST route) and MC (no local mount) are all killed.

## Hunt items (both lanes agree)

1. The gateway's static local route wins over the parametric proxy route, and the proxy answers 501 for `local` as a second guard. A machine registered with the gateway's own URL is forwarded once, to the plain `/api/session-pins`, and does not loop.
2. The body arrives unchanged. The default 30 s timeout and the app's body limit are far beyond a pin write.
3. The machine id comes from the socket's closure. `pins.changed` carries no id, so it cannot be mis-keyed, and each daemon feeds only its own machine's socket.
4. An old remote fails as it did before (row 4). A remote with the route but without slice a's nudge works, but a change made elsewhere shows only when the socket reopens or the tab resumes.
5. Owner rules: no inline comments, no assertions, the design recorded before the code (P5a triage row 5), and nothing over-built.
