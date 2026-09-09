var meta = { name: 'uiux_convergence_round16', description: 'Convergence verdict round: three bllm lanes against the fixed HEAD; zero findings on all three is the goal' };
var CONTEXT = [
  'PI WEB repo: /Users/hanxiao.du/Desktop/vincent/projects/pi-web, branch refactor/plugin-architecture, HEAD d5e0de1e.',
  'Convergence round 16 - the verdict round. Round 15 found nine defects in the architecture wave; all were fixed in 5b63f491 and d5e0de1e, with the round-15 triage at docs/design/review-triage-uiux-round15.md.',
  'READ-ONLY: do not modify any repository file. Prefer read/grep/find over bash; never run long shell commands. Write only to your output path.',
  'Every finding needs file:line and a minimal failure scenario, with an explicit TRUE/FALSE adjudication. If you find nothing, say exactly that - a clean lane is a claim, and only a real clean lane counts.',
  '',
  'Wave under review (this is the surface round 15 already combed; hunt for what it missed):',
  '- lazySurfaces.ts + PiWebApp wiring (willUpdate tree trigger, openLazySurface banner lifecycle), SessionTreeNavigator/SettingsDialog/QuickSwitcher rendering.',
  '- AppNavigationPanel compact header (scope/session/working/fold + actions row), AppContextBar, tools-section.',
  '- shared.ts listStyles (tiles, action-activity, state rail :has() selectors, reading-edge section), PromptEditor collapsed footer, sessionController prefetch, api/inFlight.ts, chatHistoryCache.ts.',
  '- pi-web-plugins machines/workspaces activityBadge.ts idle class.',
  '- Docs: phone-quality.md, operation-model.md, surfaces-as-plugins.md, review-triage-uiux-round15.md.',
  '',
  'Hunt list: pointer-query order, box model, touch floors, spacing/type literals, cascade traps ([hidden] vs author display, rule order), stale state across switches, error/banner lifecycle honesty, docs-vs-code drift, and any producer of a mark or rail that the round-15 fixes did not convert.',
].join('\n');

var laneA = runs.run('lane-a', {
  agent: 'design-reviewer-d', timeoutMs: 5400000, label: 'round16 glm A', output: '/tmp/r16-lane-a.md',
  task: CONTEXT + '\n\nYOUR FOCUS: geometry and contracts - pointer-query order, box model, touch floors, spacing/type literals, cascade and rule-order traps.',
});
var laneB = runs.run('lane-b', {
  agent: 'design-reviewer-e', timeoutMs: 5400000, label: 'round16 glm B', output: '/tmp/r16-lane-b.md',
  task: CONTEXT + '\n\nYOUR FOCUS: behavior and data - lifecycle honesty (banners, errors, hidden marks), prefetch and cache keys, in-flight sharing, lazy load paths, state across switches.',
});
var laneC = runs.run('lane-c', {
  agent: 'qwen-parity-reviewer', timeoutMs: 5400000, label: 'round16 qwen full', output: '/tmp/r16-lane-c.md',
  task: CONTEXT + '\n\nYOUR FOCUS: full pass, no split - cross-file inconsistencies, dead rules, docs claiming what code does not do, and producers the round-15 fixes missed.',
});
var results = await Promise.all([
  laneA.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneB.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneC.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
]);
return results.map(function (r, i) { return { lane: ['A', 'B', 'C'][i], ok: r !== null && !('failed' in Object(r)) }; });
