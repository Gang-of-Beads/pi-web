# Review triage: live surfaces P1 slice 4 (the app row says why a read is unanswered)

Run 98e437b2, two lanes on the reviewer shell:
- Opus 5.5, focused on the classifier, the reason text and the row's lifecycle;
- DeepSeek 4.1 max, a full pass.

Both used the ponytail and bob lenses. Brief: `/tmp/p1s4-review-task.md`. Each claim was checked against the source before it was fixed.

## Opus lane (verdict: OK with notes, one P2)

| id | finding | verdict | action |
|---|---|---|---|
| O-P1 | A proxy in front of PI WEB answering 502 for a remote machine's URL made the row blame that machine. Examples: Vite's proxy during a dev reload (an empty `text/plain` body), or nginx. `HttpError.machineId` falls back to the URL, and the classifier could not tell the gateway from any other hop | true: the row stated something false about a named machine | `HttpError` carries `answeredBy: "gateway"` only when the body names the machine, which PI WEB's gateway always does (`sendGatewayError`). A hop status is `machine-unanswering` only then, and `link-down` otherwise. Tests: two classifier rows, plus `http.errorOrigin.test.ts` for the body with and without `machineId`. Both guards mutation-checked |
| O-P2 | A non-JSON error behind HTTP/2 has an empty `statusText`, so the row read "*name*: " | true | An empty reason reads "HTTP *status*". Classifier row; mutation-checked |
| O-P3 | The probe's selector also matched transient notices | true | It counts only a transient status line with no dismiss control. Every notice has one, and the row has none, on both builds |
| O-P4 | "Earliest unanswered" was written twice | true | `earliestUnanswered` moved next to `Unanswered` in `scopedResource.ts`, and `unanswered(keys)` reduces with it |
| O-P5 | At boot, before the roster answers, the row can name a machine by its id ("local: …") | true, and consistent with the machine-health notice's fallback | Unchanged. The name comes from the roster, so a roster error cannot be named from it; the words are the owner's to change |
| hunt 1.4 | 503 from `sessionRoutes` will carry a real reason when session reads join the row (P2) | noted | Settle it with `daemon-restarting` in P2 |

Found while fixing O-P1: `clients.ts` and `pluginBackends.ts` throw `HttpError` with status 0 for a transport failure, and the classifier would have called that a server error. Status 0 is now `link-down`. Classifier row; mutation-checked.

## DeepSeek lane (verdict: OK with notes, two P2)

DeepSeek reviewed the live tree, which by then held the Opus fixes, and verified each of them.

| id | finding | verdict | action |
|---|---|---|---|
| DS-P2-1 | The gateway mark reached the row, but not three notice producers, and a notice outranks the row. Machine health and runtime (`machineDownNotice`), the boot's `safeRemoteHealth` and the deep-link ladder all named the remote "unavailable" for a read that failed locally, which was the exact case this slice fixed | true: the same symptom from sibling producers. Health and runtime are answered by the web process in use, which reports a down remote as `ok:false`, so a failed read is never evidence about the remote | All three follow the one classifier. Health and runtime go through a lookup table: nothing answered, no notice unless the reader asked (Settings); the gateway named the machine, the machine; a server error or a refusal, its own words. A failed boot health read records the remote's health as `unknown` rather than `offline`. The ladder names the machine only when the web process answered that it is down (`remoteReportedDown`). Tests: four in `machineController.test.ts`, the boot health test rewritten, and one ladder test. Five mutations caught. The two ladder tests now write the answered health to the state, as the real read does |
| DS-P2-2 | The reviewed diff was stale, and staging from its file list would leave `http.ts` behind | true | The commit stages `http.ts`, `http.errorOrigin.test.ts` and this triage by path |
| DS-P3-1 | `readPhase.ts` re-declared `LOCAL_MACHINE_ID` | true | It imports the one in `machineKeys.ts` |
| DS-P3-2 | The docs said a 502 "naming" a remote machine, while the code requires the gateway's body; object-model §2.3 still said every server-error claim holds the row until dismissed | true | Both rewritten, and §2.3 now records how the health, runtime and ladder producers speak |
| DS-P3-3 | The reason is not clamped in the row | true, and the same as the existing notices | Unchanged. Clamp it if a long reason shows up live |
| DS-P3-4 | The boot fallback to the machine id | same as O-P5 | Unchanged, as triaged |
| DS-P3-5 | `earliestUnanswered` has no direct unit test | true, low | Covered through `unanswered(keys)`, including the earliest key and the clear |

## Verification

- **Tests:** the classifier, resource, row and words tables. Nine guards are mutation-checked:
  - five from the first round (a remote hop, the hop set, the reason the row shows, the server-error words, and the miss updating per try);
  - four from the Opus fixes (the gateway check, status 0, the empty reason, and the gateway mark in `http.ts`);
  - five from the DeepSeek fixes (a background link-down notice, the machine named only by the gateway, an asked-for runtime read, unknown counted as down, and a failed read recorded as offline).
- **Probe** `scripts/probe-row-cause.mjs`, phone 393x850:
  - old build: 4/6 (a 500 read "Reconnecting…");
  - new build: 6/6 on the final tree; the slice 1-3 probes still pass (10/10, 13/13, 8/8).
- **MCP** on 8505 at 393x850: the projects read answered 500 five times, the row read "Local: Project store is locked" at the top and left once answers flowed, and the console held only the injected 500s and the blocked remote.
- **Found live, not in this slice:** while the projects read is unanswered, the sessions board says "No sessions yet.", an empty claim before an answer. This belongs to the sessions board slice (P4) and is recorded in CHECKLIST.
