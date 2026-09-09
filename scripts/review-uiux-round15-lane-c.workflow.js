var meta = { name: 'uiux_round15_lane_c_rerun', description: 'Re-run the qwen full-pass lane of round 15 against the fixed HEAD' };
var CONTEXT = [
  'PI WEB repo: /Users/hanxiao.du/Desktop/vincent/projects/pi-web, branch refactor/plugin-architecture, HEAD 5b63f491.',
  'Convergence round 15, lane C (full pass, no split). Lanes A and B found nine true findings, all fixed in 5b63f491.',
  'READ-ONLY: do not modify any repository file. Prefer read/grep/find over bash; never run long shell commands. Write only to your output path.',
  'Every finding needs file:line and a minimal failure scenario, with an explicit TRUE/FALSE adjudication. If you find nothing, say exactly that.',
  '',
  'Wave under review plus its fixes: lazySurfaces.ts (first-load-only requestUpdate, surfaceLoaded removed), PiWebApp.ts willUpdate tree trigger and openLazySurface failure retirement, AppContextBar.ts .working[hidden], shared.ts .action-activity[hidden] + tiles small line-height, machines/workspaces activityBadge idle class, AppNavigationPanel.ts compact-fold real box + tools-section reading-edge, PromptEditor.ts collapsed gutter padding, sessionController prefetch machine key + forget-on-failure.',
  '',
  'Hunt list: verify the fixes themselves hold (no loop remains, idle truly hides, keys consistent); then anything the fix commits broke; docs claiming what code does not do; cross-file drift between the wave and its tests.',
].join('\n');
var result = await runs.run('lane-c', {
  agent: 'qwen-parity-reviewer', timeoutMs: 5400000, label: 'round15 qwen rerun', output: '/tmp/r15-lane-c.md', task: CONTEXT,
});
return { ok: result !== null && !('failed' in Object(result)) };
