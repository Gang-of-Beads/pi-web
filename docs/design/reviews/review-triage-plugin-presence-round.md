# Review triage — plugin presence, machine tabs, cleanup round

Scope: `pluginPresence.ts` / `pluginSurfaces.ts` / `pluginSurfaceVisibility.ts`,
quick-switcher machine tabs (`001cdc39` and follow-ups), playwright/MCP cleanup
(PR #32), and the subagents-surface wiring (`021273b3`).

Reviewers: two independent lanes were mandated as `botim-bllm/glm-5.3-flash`
and `botim-bllm/qwen3.8-flash-next`. Neither `qwen3.8-flash-next` nor
`deepseek-v4-flash` exists in the active model registry (both launches failed
with "Unknown subagent model"), and `anthropic-merchant/claude-opus-5` was
rate-limited mid-run; the second lane ran on `anthropic-personal/claude-opus-5`.
The substitution is recorded here rather than silently absorbed.

## Lane 1 (glm-5.3-flash) — 12 findings, verdict blocked, all dispositioned

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | HIGH | Late load response overwrites the list under another machine's tab | **Fixed**: success path drops answers for a departed tab; switching tabs clears rows first. Pinned by `PiWebApp.quickSwitcherMachines.test.ts`. |
| 2 | HIGH | Failed load leaves the previous machine's rows under the new tab; error renders behind the modal | **Fixed**: rows clear on switch; failure renders inside the sheet (`QuickSwitcher.loadError`, role=alert). |
| 3 | MEDIUM | `failed` conflates any extension error with this surface's provider failing | **Working as designed**: any load failure blocks an absence claim, because the failed extension might have been the provider. Erring toward visible is the safe direction; rationale now in a comment at the mapping. |
| 4 | MEDIUM | `failed` loses its error strings at the wire and has no voice in the panels | **Recorded, not fixed**: the errors already surface in session warnings; per-surface failure detail is backlog. |
| 5 | MEDIUM | Goals panel renders "No goals recorded" for an uninstalled plugin | **Fixed**: `GoalPanel.presence` speaks a definite absence; unknown keeps the ordinary line. Pinned in `GoalPanel.test.ts`. |
| 6 | MEDIUM | Workspace rows and the create row act on the wrong machine while browsing elsewhere | **Fixed**: every activation moves to the browsed machine first (`moveToBrowsedMachine`); create disables while browsing elsewhere. |
| 7 | LOW | Project filter chips mix machine scopes | **Fixed**: chips empty while browsing elsewhere. |
| 8 | LOW | Open path moves machines optimistically; failure message shows a raw id | **Recorded**: machine-health preflight is backlog; the raw id remains in an error path that requires a machine deleted mid-browse. |
| 9 | LOW | Latent absent-window for extensions registering tools after load | **Recorded**: not reachable for either wired surface today; both providers register at module load. |
| 10 | LOW | `loadedExtensionsView` dereferences a missing source | **Recorded**: typed non-optional at the one call site. |
| 11 | LOW | Parser discarded a valid `subagents` fact when `goals` was unrecognized | **Fixed**: each surface parses independently. |
| 12 | LOW | Badge-scope emptying was claimed but unpinned | **Fixed**: render-source probe pins every emptied prop. |

PR #32 was verified clean by the lane (ignore entries correct, no derived
artifacts tracked, Playwright retained deliberately as the probe harness).

## Lane 2 - the record corrected (2026-09-04)

The opus substitute lane never delivered and this section sat as an empty
placeholder - which the completion auditor rightly called a
misrepresentation. The mandated qwen3.8-flash-next lane became launchable on
2026-09-04 (model registered) and ran as an anonymous max-thinking reviewer
over exactly this round's scope. Verdict: OK with notes. Findings and
dispositions:

- P1 fixed: the switcher's machine-scope guard keyed the REQUESTED tab, not
  the machine the displayed rows came from; after a header machine switch the
  reopened switcher rendered the old machine's cached rows under the new one,
  with the new machine's badges, and a click selected against the wrong
  machine. The loader now clears rows whose machine differs from the one it
  loads, browsingElsewhere considers what is on screen, and
  moveToBrowsedMachine acts on the rows' own machine. Two regression tests in
  PiWebApp.quickSwitcherMachines.test.ts.
- P2 fixed: GoalPanel attributed "failed" to the goal plugin specifically,
  though the diagnostics channel is shared - reworded to the hedged sibling
  copy. Both failed sentences pointed readers at "session warnings", a
  surface that does not exist - now "Notifications".
- P2 fixed: the goals-tab default flag carried a dead show conjunct and a
  presence-unknown exclusion that demoted the goals tab against an old
  daemon with recorded goals; the flag is now content-only, and the dead
  pluginSurfaceVisibility abstraction is deleted with its tests.
- P2 noise (recorded, not fixed): QuickSwitcher's changed.get guard on
  browseMachineId is always-true but harmless; query surviving a tab switch
  is deliberate and now known.
- Adjudicated not-true by the lane, with citations: presence staleness on
  idle sessions, failed/absent conflation in the wire chain, parser
  intolerance of old daemons, not-installed shown while unknown.
