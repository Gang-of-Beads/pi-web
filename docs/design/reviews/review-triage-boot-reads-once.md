# Review triage: P6 slice a, a boot reads each socket-kept fact once

Review run `44fc106b`. Two lanes on `reviewer` read a frozen worktree at `d444a130`. Each finding was checked against the source before triage.

## Opus 5.5: OK with notes

| # | Finding | Verdict | Action |
|---|---|---|---|
| P2-1 | A deletion runs read can go to the wrong machine. The flight's closure looked the machine up when it ran, not when it was requested. A trailing pass after a machine switch therefore asked machine B for project P's runs, and a pass for a key no longer selected still went out. The answer was dropped by the key check, so nothing wrong was shown; the request was wasted. | **True.** | **Fixed.** The machine is captured with the request. A pass whose key is no longer selected sends nothing. Test: "sends no deletion runs read for a project the reader left while an earlier read was on its way". Mutant RB killed. RA (machine looked up at run time) survives as an equivalent mutant: once the stale-key guard has passed, the key (machine + project) matches the selection, so both lookups give the same machine. |
| P3-2 | A handshake-timeout drop restarted the grace. `checkLiveness` set `waitingSince` on every drop, including a connection that never opened. That contradicted `phaseFor`'s rule that only a connection that had been open restarts the wait. The cost was a late read, never a lost one. | **True.** | **Fixed.** Only a dropped connection that had opened restarts the wait, as `onclose` already did. Test: the liveness-drop phase test covers both a hung handshake and a silent open connection. Mutant RD killed. |
| P3-3 | A fallback could read the pins of a machine removed from the roster within the grace, and might try to adopt local pins on it. | **True.** | **Fixed.** The fallback asks only for the selected machine or one still in the roster. Test: "reads nothing for a machine that left the roster before its grace was over". Mutant RC killed. |
| P3-4 | The comment in `setState` claimed that `setState` stays free of network side effects. It did not before this diff (unread sync), and the deletion runs read adds another. | **True.** | **Fixed.** The comment now says only what holds: the selection paths read for themselves, and the poll picks up the rest. |
| P3-5 | Ponytail: `anchoredRead`'s lookup table, with an `if` routing around it, decides one question that `graceRemaining` already answers. `socketKeptRead` also both classifies and arms a timer. | **True.** | **Fixed.** `anchoredRead` is `graceRemaining > 0`. The timer moved into its own executor, `armFirstOpenFallback`. The phase table test is unchanged and still passes. Mutant RE killed. |

Hunt items, as the lane answered them:

- A read is never lost.
- The fallback timer is one per machine, is cleared on disconnect, and does not re-arm forever.
- `phaseFor` is correct apart from P3-2.
- Deletion runs: every path that used to read still reads. A project with no workspace is now read too. `setState` recursion is safe. The trailing pass is P2-1.
- `pageshow`: no harm.
- Owner rules hold.

The lane noted one pre-existing gap. An unread set not yet read renders as "nothing unread", because `unreadSessionIds` returns empty with no projection. This slice lengthens that window by at most the 1.5 s grace, and only when the socket is slow. **Not fixed here:** it belongs to the unknown-state work of B48/B8. It is recorded in CHECKLIST.

## DeepSeek 4.1 flash max: BLOCK on F1

| # | Finding | Verdict | Action |
|---|---|---|---|
| F1 (P1) | A remote machine's unread set was still read twice per boot. `setState` synced unread before `handleMachineChange` and `syncMachineActivitySubscriptions` created that machine's socket. The need therefore saw no socket (`absent`) and read at once, and the socket's open read again a few milliseconds later. A remote deep link did the same for the selected remote. The probe could not see it: it counted only local paths and blocked the remote. | **True.** Reproduced live on the deployed P6a build: 8505 registered as its own second machine got 2 unread reads, at 71 and 98 ms. | **Fixed.** `setState` syncs unread after the socket work, so a new machine's socket is `connecting` when the need is decided. An offline remote, for which no socket is wanted, still reads at once. Test: "leaves a remote machine's unread set to its activity socket when the roster brings both at once". Mutant SA killed. Probe leg added: "a boot reads a second machine's unread set once", old 2 reads. |
| F2 (P2) | One failed read stops the only retry. A project change clears the runs shown, so a read that fails leaves no pending run to keep the 1 s poll alive, and nothing reads again until another trigger. Meanwhile the delete affordance reads "no deletion pending". | **True.** | **Fixed.** A failed read for the selected project is tried again on the shared backoff (1, 2, 4, 8 s, capped at the quiet window) for as long as the project stays selected. The retry is cancelled on a project change and on a successful answer, and a stale retry reads nothing. Test: "tries a failed deletion runs read again on the shared backoff…". Mutants SB, SC and SD killed. **Not changed:** the delete affordance reads "no deletion pending" while the runs are unknown. The daemon refuses a second removal on its precondition, so the cost is a refused request. An honest unknown here is part of the B48/B8 unknown-state work, and is recorded in CHECKLIST. |
| F3 (P2) | The deletion runs read's machine is resolved at run time, so a slow answer could be applied under the wrong machine when the reader comes back. | **True.** Same as Opus P2-1. | **Fixed** with P2-1: the machine is captured with the key. |
| F4 (P3) | The `setState` comment is inaccurate. | **True.** Same as Opus P3-4. | **Fixed.** |
| F5 (P3) | Optional simplifications: three encodings of the grace rule; `ensureLoaded`'s re-check duplicates the caller's. | `anchoredRead`: **true**, fixed with P3-5. `ensureLoaded`: **kept**, as the lane suggests, because it is the tested contract of the controller. | See P3-5. |

The lane's hunt list found no lost read and no wrong-key application on the paths it named, beyond F1–F3.
