# Review triage: B23, plugin surfaces move to the Go to page

Change: Goals becomes a `workspacePanels` page, and the `drawerSections` injection point is removed from core (rule 7 of `state-diagram.md`). Review run `643c82c8`: two lanes on the builtin `reviewer`, Opus (`anthropic/claude-opus-5-5`) and DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`), with the ponytail-review and bob lenses. Brief: `/tmp/b23-review-task.md`.

## Opus lane (verdict BLOCK; both blockers fixed)

| id | finding | verdict | action |
|---|---|---|---|
| F1 | `barTemplate.test.ts:43` still lists the drawer header, so the suite fails | true (reproduced: 1 failed) | fixed: entry removed |
| F2 | changeset and test say a legacy plugin "shows as failed"; the throw only reaches `console.warn` (`PiWebApp.registerExternalPlugins`) | true, for every browser plugin failure, not only this one | wording made true (the console names the replacement). Showing browser load and registration failures on the plugin card is added to B38 |
| F3 | the Go to badge never fills until the page is opened; the drawer drew its section even when folded | true | fixed: `badge` and `summary` start the same guarded read as `render`. Test `fills the Go to count without the page being opened` failed first |
| F4 | `activation.dispose?.()` before the throw is unguarded and duplicates `releasePluginResources` | true | fixed: the check runs after `addDisposer`, and the registry's release path disposes |
| F5 | the ledger's `source` field (`"goal-panel"`) is written and never read | true, and it predates this change | moved to CHECKLIST maintenance as its own commit |
| F6 | `drawerMachineId` names a drawer that no longer exists | true | fixed: renamed `machineId` |
| F7 | tracked probes query drawer selectors | true for `probe-plugin-matrix` (its goals legs would now SKIP silently) and the three `verify-*drawer*` scripts; the shell-row, waved and vertical-budget probes still hold (they assert "absent or collapsed") | fixed: drawer-only scripts deleted, the plugin-matrix goals legs removed; `probe-goals-page.mjs` replaces them |
| F8 | the plugin API contract package needs a `plugin-api-v*` tag | true | deferred to the next release, which needs the owner's go |
| F9 | unrelated working-tree changes must not be staged | true | commit stages exact paths |
| S1 | a gap left above the chat scroller | false | probe leg: the scroller top equals the bar bottom (44 = 44) |

## DeepSeek lane (verdict BLOCK on F1; fixed)

The lane read the live tree, which had moved past `/tmp/b23.diff`, and verified the Opus fixes in place.

| id | finding | verdict | action |
|---|---|---|---|
| F0 | `barTemplate.test.ts:43` drawer producer | true (same as Opus F1) | fixed |
| F1 | `probe-reads.mjs` leg C and `probe-vocabulary.mjs` leg B read Goals text on the chat screen, so the batch run goes red | true | fixed: both legs deep-link to the page (`view=goals:goals`); docstrings updated |
| F2 | `probe-goals-page.mjs` depends on a hand-written goal file | true | fixed: the probe writes its own fixture |
| F3 | `"goal-panel"` has no producer, and a plugin page has no slash-command seam | true | the dead value goes with the ledger `source` field (maintenance, as Opus F5). A `runCommand` seam for pages waits for a page that needs it (YAGNI); the own-goal-plugin design decides it |
| F4 | `verify-vertical-budget.mjs` measures a drawer that is always null; `research-drawer-targets.mjs` targets the drawer; `verify-shipped-fixes.mjs` reads `.drawer-tab` | true | fixed: the drawer column is removed and the research script deleted. `verify-shipped-fixes.mjs` was already recorded as stale (`state-sync-redesign.md:715`), and only its `.drawer-tab` read is new; left with that record |
| F5 | the deleted cascade-order guard leaves the remaining coarse block unguarded | true, no live bug (the only later re-declaration sets the same value) | not fixed: the guard was written for the drawer's `44px` override; no coarse override in ChatView is shadowed today. B35 (touch floor) re-adds a guard where it raises targets |
| F6 | `Reflect.has` refuses an explicit `drawerSections: undefined` | true, no instance | fixed: `Reflect.get(...) !== undefined` |
| ponytail | drawer wording left in comments (`ChatView.ts:197`, `panelHeaderStyles.ts:6`, `QuickSwitcher.ts:564`, dead `SessionList.ts`) and design docs | true, comments only | not fixed here: historical design docs keep their record; the comment sweep goes with B16 maintenance |

## Live verification (8505, 393x850, coarse pointer)

`scripts/probe-goals-page.mjs`:
- Old build (`c2411e77`): 1 of 3 legs passed. The drawer sat between the bar (bottom 44) and the transcript (top 89), and Goals was missing from Go to.
- New build: 6 of 6 passed. The bar and the scroller both end or start at 44; Goals is listed and opens a page titled Goals showing the seeded goal; the status dot is at x = 8.
- A first run showed the dot at x = 0, cut by the screen edge. That became a test, which failed first, and was fixed.
