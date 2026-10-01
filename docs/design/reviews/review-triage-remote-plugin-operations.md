# Review triage: a remote machine's plugin operations reach their own machine (B50)

Commit under review: `70b09ba8`. Review run `06788e64` had two lanes on the builtin `reviewer`: Opus 5.5 and DeepSeek 4.1 flash max, with ponytail and bob lenses. They read a frozen worktree at `/tmp/pw-b50`. Brief: `/tmp/b50-review-task.md`.

**Verdicts.**
- Opus: OK with notes, three P2.
- DeepSeek: OK with notes, four P2.

Neither found a P0 or P1.

## Findings

| # | Lane | Finding | Verdict | Action |
|---|---|---|---|---|
| 1 | Opus P2-1, DeepSeek hunt 3 | The federated route did not carry cancellation. A closed tab left the gateway waiting up to 30 s, and the remote finished work nobody would read. The local route cancels the daemon call. | TRUE | **Fixed.** `propagateCancellation: true` on `POST /plugins/:pluginId/:operation`. Pinned in `federatedRouteContract.test.ts`; mutant NE is killed. |
| 2 | Opus P2-2, DeepSeek P2-2 | The probe added its machine before launching the browser, and deleted it in the same `finally` as `browser.close()`. A failed launch or close left `probe-remote-operations` on the 8505 roster. | TRUE | **Fixed.** The launch is inside `try`, and the delete runs in an inner `finally` after the close. |
| 3 | DeepSeek P2-1 | The probe counted any 2xx, and an unrouted path answers 200 with the page's HTML. A dropped allowlist entry would have passed live. | TRUE (the unit test already catches it) | **Fixed.** An answer counts only with an `application/json` content type. |
| 4 | Opus P2-3, DeepSeek P2-3 | `pluginOperationPath` took a runtime id it needs only for gateway registrations, where it equals the source id (`registry.ts:61`). It also spelled the gateway/machine prefix a second time. `api/clients.ts` already had `pluginsPath(machineId?)`, and the rest of the client spells "the gateway" a third way. | TRUE (simplification) | **Fixed.** `pluginOperationPath(machineId, sourcePluginId, operation)` builds on the exported `pluginsPath`. Mutants NA (runtime id on the machine path), NB (everything to the gateway) and NC (no federated route) are killed. |
| 5 | DeepSeek P2-3 | A roster machine whose id is literally `local` would hit the proxy's 501. | FALSE for generated ids, which are UUIDs. TRUE only for a hand-edited `machines.json`. | None. |
| 6 | DeepSeek P2-4 | A remote registration's offer can now open, and two offers do not name their machines. | TRUE | **Owner decision**, already queued (`review-triage-update-offer.md` row 2). |
| 7 | Opus residual | The subagents plugin is not `machineSpecific`. The gateway's registration serves a remote machine's sessions, and its `runs.list({ sessionFile })` reaches the gateway's daemon with the remote machine's path. | TRUE, older than B50, the same rule broken by a sibling | **Recorded as B52** (CHECKLIST). |
| 8 | Both | Default 30 s federated timeout. A remote refusal reaches the plugin intact. An unreachable remote answers 502 `{error, machineId, …}`, which the goals plugin renders as failed, not as "no goals". No new reach beyond the remote's own `/api/plugins` surface. Per-machine answered storage matches `state-diagram.md`. No `as` assertions, no inline comments. | FALSE (no defect) | None. |

## Found on the way: B51

The B50 MCP run, with 8505 as its own selected remote, showed the remote machine's goals, subagents, terminal and workspaces plugins failing to load:
- Each throws `NotSupportedError: … "pi-web-goals-section" has already been used with this registry`.
- The page imports every plugin module again for each remote machine, and Lit's `@customElement` defines without checking whether the name is taken.

It is fixed in its own commit (B51). The test imports every bundled plugin module, and every file that defines an element, twice.

## Evidence for the follow-up

- `registry.test.ts`, `app.remoteProxy.test.ts` and `federatedRouteContract.test.ts` pass.
- Mutants NA, NB, NC and NE are killed, 4 of 4.
- tsc, eslint and knip are clean.
- `probe-remote-plugin-operations.mjs` on the rebuilt 8505: the result is in the commit record.
