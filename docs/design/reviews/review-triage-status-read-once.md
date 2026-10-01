# Review triage: one PI WEB status read shared with plugins (P7 slice c)

Commit under review: `e5913583`. Review run `19347e5e` had two lanes on the builtin `reviewer`: Opus 5.5 and DeepSeek 4.1 flash max, with ponytail and bob lenses. They read a frozen worktree at `/tmp/pw-status1`. Brief: `/tmp/status1-review-task.md`.

**Verdicts.**
- Opus: OK with notes, three P2.
- DeepSeek: OK with notes, five P2.

Neither found a P0 or P1.

## Findings

| # | Lane | Finding | Verdict | Action |
|---|---|---|---|---|
| 1 | Opus P2-a | Saving PI WEB's config clears the web process's status cache (`invalidatePiWebStatusOnWrite`, `server/web/app.ts`). A press of the refresh control within 30 s then shows the client's older answer, where before it showed a fresh one. | FALSE (read the source; both lanes had not traced the control) | **None.** The refresh control on screen is a full page reload (`app-refresh-control` → `hardReloadApp`, `PiWebApp.ts`, `AppNavigatePage.ts`), which drops the client cache. `refreshAppData` is reached only from git's "New worktree" submit, and nothing re-read the status after a config save before this diff either. A `"reuse" \| "ask"` freshness was built and then removed (ponytail: no caller needs it). |
| 2 | Opus P2-b, DeepSeek P2 | The host fact was pinned to `"local"`, but the updates plugin is machine-specific. A remote registration's `callOperation` reaches the remote machine while its status was the gateway's. Once the offer can fire (row 6), every remote registration would weigh the local release against that remote's answered versions. | TRUE. The behaviour is as old as the plugin, but the new contract would have fixed it in place. | **Fixed.** The registry hands each registration a reader of its own machine (`registration.machineId ?? "local"`). The docstring says "the machine this registration belongs to". |
| 3 | DeepSeek P2 | The context's `piWebStatus` (a function) and the runtime state's `piWebStatus` (a value) shared a name. | TRUE | **Fixed.** The context function is renamed `readPiWebStatus`. It has not been released, so nobody depends on the old name. |
| 4 | DeepSeek P2-1 | A forced check's answer survives a read that left before it only because `checkForUpdates` replaces the whole entry. No test pinned that. | TRUE | **Fixed.** A test pins it ("keeps a forced check's answer when a read that left before it lands after it"). Mutant FC writes the forced answer into the live entry, and that test kills it. The docstring states the invariant. |
| 5 | DeepSeek P2 | `if (entry.flight === flight)` in `finally` is always true: a flight is only set on an entry that has none, and a replaced entry is unreachable anyway. | TRUE | **Fixed** (ponytail): `finally` deletes the flight unconditionally. Mutant FE (flight never released) is killed. |
| 6 | Opus P2-c | Separate, older defect: the updates offer reads a top-level `version` the status never has. `running` is always unknown, so the offer has never fired, since `fd56eb53`. | TRUE (8505's `/api/pi-web/status` keys: packageName, generatedAt, components, release, commands, messages) | **Separate commit.** `piWebOfferFacts(status)` takes `components.web.installedVersion ?? runtimeVersion`, the version the server compares the release against (`server/shared/piWebStatus.ts`). It lands after this follow-up, because row 2 must land first. |
| 7 | DeepSeek P2 | The probe's control proves the plugin registered, not that it asked for the status through the host fact. | TRUE, low | **Not fixed here.** A timing-based control would be flaky. The registry and plugin unit tests cover the leg. Row 6's commit adds a probe leg in which the plugin can only show the offer by reading the status. |
| 8 | Opus 6 (optional) | Store one `{ promise, at }` instead of `{ flight, answer }`. | Cosmetic | **Not taken.** The named `StatusRead` makes the two halves readable, and the lane did not ask for it. |
| 9 | Both, hunt 1, 3, 5, 7 | Scope leak across machines; a failed read cached; API declared inconsistently; `as` assertions or inline comments. | FALSE | None. |

## Evidence for the follow-up

**Tests.** Three new or changed tests:
- forced answer against an older read;
- each registration reads its own machine (the registry test, rewritten);
- the plugin uses `readPiWebStatus` (renamed).

Two fail on HEAD. The forced-answer test pins behaviour that already held, as finding 4 asked.

**Mutants.** 3 of 3 killed:
- FB: every registration reads local;
- FC: forced answer written into the live entry;
- FE: flight never released.

**Checks.** tsc on the app and the plugins, eslint and knip are clean.

**Live, rebuilt 8505.**
- `probe-boot-reads.mjs` passes 13/13, with one status read.
- Playwright MCP on a 393x850 phone, with 8505 added as its own remote and that remote selected:
  - the local `updates` registration read `api/pi-web/status` (703 ms);
  - the remote registration read `api/machines/<id>/pi-web/status` (1,032 ms);
  - the page's refresh of the selected machine reused that answer.
  - Each machine was read once, under its own scope. The probe machine was removed afterwards.
