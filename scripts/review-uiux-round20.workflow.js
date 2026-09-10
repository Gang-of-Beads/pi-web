var meta = { name: 'uiux_convergence_round20', description: 'Convergence verdict round 20: three bllm lanes against the banner-model HEAD; zero findings on all three is the goal' };
var CONTEXT = [
  'PI WEB repo: /Users/hanxiao.du/Desktop/vincent/projects/pi-web, branch refactor/plugin-architecture, HEAD 1c2013f7.',
  'Convergence round 20. Round 17 (docs/design/review-triage-uiux-round17.md) found ~23 defects across three lanes; the mechanical ones were fixed in 646a0d5a and the owner then decided five product questions, all implemented in b0bce2a0, and the round-18 lanes\' 15 further findings fixed in ed0cd40f and the round-19 lanes\' seam findings fixed in 1c2013f7 (see docs/design/review-triage-uiux-round19.md):',
  '- Banner retirement model: HttpError is reader-retired (an HTTP status is an answer, not silence); link-level failures (TypeError, RequestTimeoutError) keep reply retirement; reportTransportReachable(url) vouches for the machine the URL addressed (errorMachineId on state; "local" for unscoped claims is disproved by any success); the 6s expiry checks errorRetiredBy instead of matching wording; noticeFromTransport/noticePatch carry machineId; machineController reconnect messages are reply+machine-scoped.',
  '- Rail follows dot: shared.ts rail rules now wear the dot palette - unread purple, running accent, asking warning, machine/workspace activity-indicator.session success, terminal accent, error danger; source order encodes precedence unread < running < asking.',
  '- The machines plugin permanently-hidden compact switcher (MachineSwitcher.ts) is deleted; the plugin renders machine-list everywhere; AppNavigationPanel orphan CSS removed; audit-uiux-full contextSheet trigger now targets the real context row with a bounded poll.',
  '- interrupted-runs: loadInterruptedRuns returns undefined on failure; refreshInterruptedRuns keeps prior markers and shows a reader banner "status is unknown" instead of adopting an empty record.',
  '- errorBanner normalizeTransientError fetch-family patterns anchored to whole message (composites keep the machine name).',
  '',
  'READ-ONLY: do not modify any repository file. Prefer read/grep/find over bash; never run long shell commands. Write only to your output path.',
  'Every finding needs file:line and a minimal failure scenario, with an explicit TRUE/FALSE adjudication. If you find nothing, say exactly that - a clean lane is a claim, and only a real clean lane counts.',
  '',
  'Surface under review (the round-17 surface plus everything b0bce2a0 touched):',
  '- notice.ts / errorNotice.ts / errorBanner.ts / bannerHold / transportHealth.ts / http.ts (the new retirement model end to end - hunt for producers still bypassing noticePatch, stale errorMachineId, unscoped claims cleared wrongly).',
  '- PiWebApp.ts (clearTransientError machineId, scheduleTransientErrorDismissal, setRemoteRouteRestoreMessage, refreshInterruptedRuns, self-update banner coarse floor ordering), sessionController/machineController error sites, appState error fields.',
  '- shared.ts listStyles rail rules and precedence, sessionStateBadgeStyles dot palette vs rail, AppNavigationPanel (switcher removal leftovers), pi-web-plugins machines/workspaces (plugin renders machine-list everywhere).',
  '- Docs vs code: review-triage-uiux-round17.md and review-triage-uiux-round18.md claims, changesets banner-retirement-model.md and round-eighteen-audit.md, operation-model.md.',
  '',
  'Hunt list: the new model\'s own seams (machineId extraction from URLs, "local" fallback correctness, expiry/replacement interactions, bannerHold 1.5s hold vs new lifetimes), rail precedence under combined states, pointer-query order (the guard now checks first rules - look for what else it misses), box model, touch floors, stale state across switches, docs-vs-code drift.',
].join('\n');

var laneA = runs.run('lane-a', {
  agent: 'design-reviewer-d', timeoutMs: 5400000, label: 'round20 glm A', output: '/tmp/r20-lane-a.md',
  task: CONTEXT + '\n\nYOUR FOCUS: geometry and contracts - pointer-query order, box model, touch floors, spacing/type literals, cascade and rule-order traps, rail precedence.',
});
var laneB = runs.run('lane-b', {
  agent: 'design-reviewer-e', timeoutMs: 5400000, label: 'round20 glm B', output: '/tmp/r20-lane-b.md',
  task: CONTEXT + '\n\nYOUR FOCUS: behavior and data - the retirement model end to end (machineId scoping, expiry, bannerHold), interrupted-runs honesty, prefetch/cache keys, state across switches.',
});
var laneC = runs.run('lane-c', {
  agent: 'qwen-parity-reviewer', timeoutMs: 5400000, label: 'round20 qwen full', output: '/tmp/r20-lane-c.md',
  task: CONTEXT + '\n\nYOUR FOCUS: full pass, no split - cross-file inconsistencies, dead rules and leftovers from the switcher removal, docs claiming what code does not do, producers the new model did not convert.',
});
var results = await Promise.all([
  laneA.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneB.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneC.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
]);
return results.map(function (r, i) { return { lane: ['A', 'B', 'C'][i], ok: r !== null && !('failed' in Object(r)) }; });
