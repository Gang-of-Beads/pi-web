# Review triage: the update offer reads the version the machine runs

Commit under review: `48c73f28`. Review run `2a703621` had two lanes on the builtin `reviewer`: Opus 5.5 and DeepSeek 4.1 flash max, with ponytail and bob lenses. They read a frozen worktree at `/tmp/pw-offer`. Brief: `/tmp/offer-review-task.md`.

**Verdicts.**
- Opus: OK with notes. One P1, which is a product decision.
- DeepSeek: OK with notes. One P1 (confirmed live).

## Findings

| # | Lane | Finding | Verdict | Action |
|---|---|---|---|---|
| 1 | DeepSeek P1 | A remote registration's `callOperation` posts `api/plugins/machine.<hex>.<id>/<op>` to the local daemon, which matches catalog ids exactly and never decodes the prefix. Remote operations fail. | **TRUE, confirmed live.** On 8505, `POST /api/plugins/machine.70726f642d383530342d7761766562.updates/offer.answered` and `.../machine.<hex>.goals/goals.list` answer 404 "No server plugin named … is active". `api/machines/<id>/plugins/...` is not a route: its 200 is the page's HTML fallback. | **Older defect, recorded as B50** (CHECKLIST) and fixed as its own item. It is broader than the offer: a remote machine's goals list and voice token ride the same channel. It also corrects `review-triage-status-read-once.md` row 2, which claimed a remote registration's operations reach the remote machine. Until B50 lands, only the gateway's offer can open; a remote registration's `offer.answered` fails, and the plugin's catch keeps it silent. |
| 2 | Opus F1 (P1), DeepSeek P2 | With several machines, offers stack and none names its machine. The gateway's offer can open while another machine is on screen, and its body says "on this machine". | TRUE as a product gap. Today only the gateway's offer is reachable (row 1). | **Owner decision** (asked: which machines the offer is about, and whether it names them). |
| 3 | Both P2 | An install with no update command still gets the popup. Its text promises a terminal command, and its only button is "Not this version". | TRUE. **8504 is such an install**: a nix store path, and its status has no `commands.update`. | **Owner decision** (asked: no offer, or wording for an install that updates another way). |
| 4 | DeepSeek P2 | One flat `answeredVersions` list per daemon's plugin storage, with no machine key. | FALSE once B50 lands: each machine's own daemon keeps its own storage, which is the per-machine record the ruling asks for. Today remote operations fail, so no list is shared. | B50 decides it. Nothing here. |
| 5 | Both P2 | The probe's quiet leg never checked that the machine itself reports no newer release, and the offer leg used a fixed 6 s sleep. | TRUE | **Fixed.** The status is always intercepted and passed through. The quiet leg asserts the machine's own `updateAvailable === false`, and the offer leg waits for the dialog for up to 12 s. 7/7 on 8505. |
| 6 | Both P2 | The happy-dom test did not assert that the answer is recorded, and it used `setTimeout(0)` flushes. | TRUE | **Fixed.** It asserts the operations `["offer.answered", ["offer.answer", { version }]]` and uses `vi.waitFor`. |
| 7 | Both P2 | Three narrowings of the same record. The answered parse sat in the plugin, and `isRecord` stayed for one line. | TRUE | **Fixed.** `answeredVersionsFrom` lives beside `withAnsweredVersion` and is tested, and the plugin's `isRecord` is deleted. The server half keeps its own parse, which runs in another process. |
| 8 | Opus P2 | `running` is the installed version, so the docstring was wrong while a restart is pending. | TRUE (the docstring) | **Fixed.** The docstring says it is the version an update moves from and may be newer than the answering process. The field keeps its name, which the verdict and the dialog share; both lanes judged the label defensible. |
| 9 | Opus P2 | The plugin API docstring still advertised "(version, release, update commands)", the phrase that led to reading a non-existent `version`. | TRUE | **Fixed** in `plugin-api.ts` and `plugins/types.ts` ("its components and their versions, the release check, the update commands"), with the baseline refreshed. |
| 10 | DeepSeek P2 | The suite docstring sat on the wrong `describe`. `PiWebOfferFacts` and `PiWebUpdateOfferFacts` are near-homonyms. The fixture was hand-written, so a server shape change would go unnoticed. | TRUE | **Fixed.** The docstring is back on its suite, the type is renamed `PiWebStatusOfferFacts`, and the fixture `satisfies PiWebStatusResponse`. Renaming `messages` in the fixture fails typecheck (checked). |
| 11 | Opus P2 | `nonEmptyString` repeats a guard the verdict already has, and `latest === running` is redundant with `updateAvailable`. | Harmless | **Not taken.** The facts parser and the verdict stay independently honest about unknowns. |
| 12 | Both | Docker gives a command. A skipped check means no offer. An error offers only from a cached real answer. One registration activates once. The probe leaves nothing behind, because it never closes the offer. No `as` assertions, no inline comments. | FALSE (no defect) | None. |

## Evidence for the follow-up

- `piWebUpdateOffer.test.ts`: the fixture is typed by the plugin API, and a new answered-versions test was added.
- `pi-web-plugin.offer.test.ts`: the answer is recorded, and the waits are deterministic.
- `probe-update-offer.mjs`: 7/7 on the rebuilt 8505.
- tsc (app and plugins), eslint, and the plugin API baseline are clean.
