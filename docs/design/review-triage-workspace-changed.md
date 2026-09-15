# Review triage: workspace.changed (goal task 4)

Commit under review: 409ef711 (+ fixes below). Two glm max-thinking lanes,
split daemon watcher vs client behavior. Neither lane had a shell; both
reviewed the live files and confirmed the commit boundary from the reflog.

| # | Lane finding | Adjudication | Action |
| --- | --- | --- | --- |
| D-P1 | A runtime rebind (fork / clone / tree navigation) swapped `active` to the new session id without releasing the old hold or holding the new one: the watch kept a dead holder forever and every later session in that cwd inherited a never-droppable hold | TRUE | Fixed: the rebind callback releases the bound session and holds the replacement; `piSessionService.workspaceWatch.test.ts` pins it |
| D-P2 | `create`'s catch tore the session down without releasing the hold taken moments earlier | TRUE | Fixed: released next to `workspaceActivity.removeSession` |
| D-P2 | No subtree filtering; a project-local `sessionDir` (`.pi/sessions`) makes every transcript append a change burst (~4 frames/s per turn) | TRUE, bounded | Not fixed: reads only, no loop, capped by the 250ms coalesce and the visibility gate of the files panel. Recorded; an ignore list is a follow-up if a real project hits it |
| D-note | `hold`'s catch wipes all holders for a cwd on a sync watch failure | TRUE, consequence-free | Not fixed: releases no-op, the next hold re-establishes; nothing publishes while unwatched |
| C-P1 | The watch key and published cwd were the raw session-header value while every listing row and the browser's `selectedWorkspace.path` are canonical: `~/repo` never watches, `/private/tmp/repo` vs `/tmp/repo` never matches, and a session in `/repo/packages/app` (first-class: the workspace list covers its tree) never refreshes the workspace | TRUE | Fixed: `holdWorkspaceWatch`/`releaseWorkspaceWatch` canonicalize with `canonicalizeStoredCwd`; the verdict gains an `inside-workspace` refresh arm (segment-wise, `/repo-two` stays outside `/repo`); tests enumerate both. Symlink forms remain exact-match only, same as every other cwd comparison in the codebase |
| C-P2 | `dispose()` disposed the watcher before awaiting pending opens, so a late open could re-register a watch nothing closes | TRUE | Fixed: the watcher is disposed after pending opens settle |
| C-P2 | Files refresh had no generation guard: overlapping refreshes across a coalesce boundary could settle an older tree marked fresh | TRUE | Fixed: `FilesExplorer.refresh` keeps only the newest generation; `explorer.test.ts` pins it |
| C-P2 | Invalidation is not visibility-gated; the git panel fetches status while not shown | TRUE, report-only | Not fixed: the files panel self-gates on mount; git's poll already ran on its own timer. A mounted-only gate is a registry-level change for a later wave |
| C-Q2/Q3/Q5 | Nested cwds, machine activity sockets, probe attribution | FALSE / correct as built | Both lanes verified: exact scoping, activity sockets ignore the frame by design, the files panel has no timer so the probe's marker can only have come from the event |
| D-Q5 | Global scope replay / seq inflation | FALSE | No replay ring on the global scope; gaps are counted, not replayed |

Live: rebuilt, 8505 daemon restarted, `scripts/probe-workspace-watch.mjs` PASS
after the fixes.
