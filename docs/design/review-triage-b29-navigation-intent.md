# Review triage: B29, only the reader's intent moves the page

Report (owner, 2026-09-30): "我点了一个页面，但是页面没加载出来呢，pi web急于切页面，切过去了但是页面内容没刷新，然后我又在上面继续操作，但是过了一会内容刷新好了，pi web才现场改页面内容". The owner's choice: stay in place, and make the tap perceptible ("停在原地没问题，怎么让用户感知到他点了这个按钮呢").

Design: D8 in `state-diagram.md`. Review run `c336e7e7`: two lanes on the builtin `reviewer`, Opus (`anthropic/claude-opus-5-5`) and DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`), with ponytail-review and the bob lenses. Brief: `/tmp/b29-review-task.md`.

Verdicts: Opus **BLOCK** (four P1). DeepSeek **OK with notes** (one P1, the same as Opus F1). Both reviewed a tree slightly ahead of the brief's diff. DeepSeek said so and checked the live files.

## Findings

| id | lane | finding | verdict | action |
|---|---|---|---|---|
| O-F1 / D-F1 | both | the commit moved to the machine browsed *at commit time*, not the one the row was read from, and browsing a machine tab began no intent | true | fixed: the open carries its machine (`AppNavigatePage` passes the row's machine, the switcher its rows' machine); the move goes there (`moveToMachine`); browsing a tab begins an intent. Tests: "browsing another machine's tab", "opens on the machine the row was read from" (both fail on the pre-review code) |
| O-F2 | Opus | choosing a project, widening, a context-sheet machine choice and New session did not supersede a pending open | true | fixed: each begins an intent. New session uses `showView`, so it does not cancel itself. Tests: "choosing a project" and "starting a new session from the desktop list, the chat already showing" (both fail on the pre-review code). The two settings "refresh machine" handlers also begin one |
| O-F3 | Opus | the boot restore captured its intent after `loadMachines`, and both deferrals took `latest()` at deferral, so a tap during a flaky boot was adopted by the retry | true | fixed: the intent is captured before the first await and handed through `restoreBootRoute` to both deferrals. Test: "keeps the intent it began with" (fails on the pre-review code) |
| O-F4 | Opus | `openRuntimeTerminal` opened the terminal after a restore the reader had overtaken; workspace removal opened one after two awaits | true | fixed: both check the intent. Test: "does not open once the reader has moved on" (fails on the pre-review code) |
| O-F5 | Opus | a cross-machine commit closed the page before the machine move, uncovering the old machine's chat and half-committing if superseded | true | fixed: the page closes, the chat shows and the session is selected in one synchronous step after the move, only while current; a failed move marks the row failed |
| O-F6 / D-F4 | both | `readFirstPage` claimed its read is shared; selecting reads the page again as it joins | true | the docstring is corrected. The second read is accepted: it runs behind the seeded transcript, and B7 (heads) removes it. Stamping a watermark to force delta replay was rejected, because the same run showed delta replay missing a row (B7) |
| O-F7 | Opus | the long-press menu stayed open after Open | true | fixed |
| O-F8 / D-F6 | both | a `role=status` with only an `aria-label` is not reliably announced, the failure announcement lost the name, and the label doubled into the button's name | true | fixed: one app-level polite live region speaks `openingAnnouncement` ("Opening X", "Couldn't open X"); the row's spinner is `aria-hidden`; the words are plain text inside the button |
| O-F9 | Opus | `dispose()` uncalled; `cancel()`'s boolean unread; a double key check | partly: `dispose()` is called from `disconnectedCallback` (added after the brief), the rest true | `cancel()` returns nothing; the spinner takes no arguments, and the callers decide |
| O-F10 / D-F5 | both | missing tests: machine-tab and other supersedes, boot deferral, superseded terminal, the mark, the switcher's close at commit, a second tap, a failed read live | true | added: seven orchestration cases (six fail on the pre-review code; the switcher-close and second-tap cases are guards), `openingMark.test.ts`, and a failed-read leg in the probe |
| D-F2 | DeepSeek | D8's producer list cited stale line numbers in the present tense | true | rewritten as the pre-fix shape, by function name |
| D-F3 | DeepSeek | Settings and Add project from the Sessions page closed it without superseding, so a pending open committed behind the sheet | true | fixed: both begin an intent |
| D-F7 | DeepSeek | no changeset | true (the work was uncommitted) | `.changeset/tap-answers-page-stays.md` |
| D (partly) | DeepSeek | plugin-host `selectWorkspaceTool` and `terminal.open` move the view with no intent | true: they are synchronous calls a plugin makes on a reader's action, with no await before the move | not changed: nothing late |
| — | own | `navigationSelectionSeq` was a second intent counter that only the unused `startSessionFromNavigation` bumped | true | both removed; one owner |

Judged not true by both lanes: restores cancelling themselves, timer leaks, cross-machine seeding, a double announcement from the progress bar, and the harmless producers (`workspaceViewTransition`, `locateAndApplySessionWorkspace`, archive neighbour selection, `refreshSelectedSession`, `recreateCachedNewSession`).

## Live verification (8505, 393x850 touch)

`scripts/probe-navigation-intent.mjs`, with slowed and refused reads injected at the network layer:
- Old build (`83fa469d`): 3 of 7 legs failed. It switched to the tapped session before any content, with no mark, and selected the second session although the reader went back.
- New build: see the commit. The failed-read legs were added after the review.

Screenshots drove two layout fixes. The first build's "Opening…" squeezed a two-column tile's name to "nav -…", so the words moved to the secondary line and the spinner to the state mark's place. Then "Couldn't open · tap to retry" wrapped to two lines and made its tile row taller. The words are now "Couldn't open · retry", held to one line, and a probe leg compares the failed tile's height with a tile in another row.
