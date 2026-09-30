# Review triage: live surfaces P1, slice 1 (a projects read that never gives up)

Change: B48, object model §0, §2.1, §2.3 and §6 P1, for the projects read. Review run `78c01217`: Opus (`anthropic/claude-opus-5-5`) and DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`) with the bob and ponytail lenses. Both returned **OK with notes**, with no P0 or P1.

Live on 8505 (`scripts/probe-read-heals.mjs`, phone 393x850, projects answers dropped in the browser):
- the build before the change passes 5 of 8. It shows "Couldn't read the projects", "Projects could not be loaded" and "No projects yet", never heals and never shows the row;
- this change passes 8 of 8. A single loss heals within the grace with no row. Seven seconds of loss shows the row exactly once, and the board heals at 7.3 s.

| id | lanes | finding | verdict | action |
|---|---|---|---|---|
| O-P1 | Opus | The deep-link restore ladder gives up after about 57 s, silently now that the failure banner is gone | true | Fixed: when the listing answers, a pending restore is retried at once, and a local route's ladder keeps its last delay instead of giving up. The stale comment is corrected |
| O-P2, D-F2 | both | A 401/403 fact ends retrying with nothing on screen | true, latent (no route answers 401/403 today) | Fixed: a fact is shown as a reader notice in its own words until typed facts reach the row (§0) |
| O-P3, D-F3 | both | The sidebar ProjectList still says "Loading projects…" and keeps an unreachable failed branch with Retry | true | Fixed: both removed; the list says nothing until the listing answers |
| O-P4, D-F5b | both | "Unknown" was encoded as an empty title, which decides state by display text | true | Fixed: `WorkspacePanelEmptyState` is a union with a typed `unknown` member |
| O-P5, D-F4 | both | The navigate page claims "Nothing to choose" while projects are `unloaded` | true, pre-existing | Fixed: `loadingChoices` uses `!== "loaded"` like its siblings |
| O-P6, D-F6 | both | `dispose` has no caller, and the row's recheck timer outlives the app | true | Fixed: `ProjectController.dispose`, called from `disconnectedCallback` with the timer |
| O-P7 | Opus | A new inline comment in a test | true | Fixed |
| O-P8, D-F7 | both | A transient notice still in its grace hides a showing row | true | Fixed: the row asks whether a notice is actually on screen |
| O-P9, D-F10 | both | A read in flight can overwrite a local add or close | true, pre-existing | Not fixed here: `readVerdict` (§2.1) is the remedy and comes with the session slices |
| O-P10 | Opus | The probe misses the phone board's own texts | true | Fixed: "Nothing to choose at this level." and "Loading projects…" are dead ends in the probe |
| O-P11 | Opus | `src/client/src/sync/` is missing from bob's `writePaths` | true | Fixed |
| D-F1 | DeepSeek | `loadMachines` can switch the selected machine without reading its projects | true, pre-existing | Fixed: a changed selection reads its projects |
| D-F5a | DeepSeek | The banner's docblocks now sit above the new function | true | Fixed |
| D-F8 | DeepSeek | The row is not above the dialog layer | true | Not fixed here: the notice banner shares the same place. Both move together in their own change, with a Settings-open probe |
| D-F9 | DeepSeek | The boot-restore test stubs a `failed` the controller no longer produces | true | Fixed: it stubs `loading` |
| D-F11 | DeepSeek | No changeset; unrelated edits in the tree | true | Changeset added; staged by path |
