# Review triage: a remote machine's copy of a plugin loads beside the gateway's (B51)

Commit under review: `8c1fe161`. Review run `d5b4792f` had two lanes on the builtin `reviewer`: Opus 5.5 and DeepSeek 4.1 flash max, with ponytail and bob lenses. They read a frozen worktree at `/tmp/pw-b51`. Brief: `/tmp/b51-review-task.md`.

**Verdicts.**
- Opus: OK with notes, four P2.
- DeepSeek: OK with notes, one P1 and six P2.

Both lanes corrected the brief's premise. The page does not import every plugin once more for every machine on the roster. It does so only for the selected remote machine, and only for a machine-specific plugin or one the gateway lacks (`registry.shouldLoadRemotePlugin`, `PiWebApp.loadPluginsForMachine`). A plugin retried after a rebuild is a further second evaluation. This narrows what is reachable, and the docs now say it correctly (row 2).

## Findings

| # | Lane | Finding | Verdict | Action |
|---|---|---|---|---|
| 1 | DeepSeek F1 (P1), Opus P2-2 | files, relays and workspace-tasks reach their panel through module functions that read the class's static `active`; tasks also reads a module `configCache`. Suppose the gateway lacks the plugin and two remotes carry it. The second copy then renders through the first copy's class, while its Refresh, Upload and summary read its own class's static, which is never set. The controls silently do nothing. For files this is newly reachable: its second copy used to fail to load, so an empty plugin became a wrong one. For relays and tasks it is older, since they were already guarded. | TRUE | **Recorded as B53**, fixed in the next commit and before any release. Each activation owns a link object that it passes to its panel as a property, as the new docs rule prescribes. |
| 2 | Opus P2-1, DeepSeek F4 | The docs, changeset, test and probe named the wrong trigger ("every remote machine on its roster"). The rules sat under "Async data and caching". The changeset claimed machine lists, but machines is not machine-specific. | TRUE | **Fixed.** The rules moved to "Remote machine plugins" with the correct trigger. The changeset drops machine lists, and the test and probe docstrings were reworded. |
| 3 | DeepSeek F3 | relays, tasks and the subagents on-screen marker define their element at activation through an exported `define…` function. Importing the module twice never defined them, so reverting one guard kept the suite green. The file scan also missed a reintroduced `@customElement`. | TRUE | **Fixed.** The test calls every exported `define…` function on both imports, and the scan matches `@customElement(` too. Mutants GE (relays) and GF (tasks) are now killed, and GA still is. |
| 4 | DeepSeek F5, Opus P2-4 | A remote copy may render through another version's class, so skew is silent. | TRUE (accepted) | **Docs.** The skew rule is added: give every property a default and let every callback be absent. A version or machine in the tag would make every tag dynamic. Scoped custom element registries are the upgrade path if skew becomes a real complaint. |
| 5 | DeepSeek F2 | Per-copy `activeDialog` guards (add project, add machine, git worktree) no longer stop a second dialog from another copy. | FALSE in practice | None. These dialogs are modal, so the machine cannot be switched while one is open, and each copy's dialog belongs to its own machine. |
| 6 | Opus P2-3, DeepSeek F7 | The probe's `prod-8504-waveb` block and fixed seed ids were unexplained. The probe proves the plugins load, not that they work. | TRUE | **Docstring fixed.** It says why production is blocked and that it uses the stack's seed. "Works" is covered by the Playwright MCP run: the remote's Goals page listed its seeded goal through its own machine path. |
| 7 | DeepSeek F6 | The test covers bundled plugins only, and its element-count floor (`>= 16`) will need editing. | TRUE (accepted) | A remote-only plugin is guarded by the docs rule. The floor stops a broken scan from passing empty. |
| 8 | Both | Shared `hostUi` is one object per registry. The git and subagents shared observers belong to the first class and are used consistently. There are no module-scope global listeners. No `as` assertions or inline comments. The `designTokens.test.ts` widening is correct. | FALSE (no defect) | None. |

## Evidence for the follow-up

- `secondMachineCopy.test.ts` passes 34/34.
- Mutants GE, GF and GA are killed, 3 of 3.
- tsc and eslint are clean.
