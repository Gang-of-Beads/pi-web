var meta = { name: 'uiux_convergence_round15', description: 'Zero-discovery convergence round: two glm lanes with split focus plus one qwen full pass over the architecture wave' };
var CONTEXT = [
  'PI WEB repo: /Users/hanxiao.du/Desktop/vincent/projects/pi-web, branch refactor/plugin-architecture, HEAD 0664ee35.',
  'This is convergence round 15. Rounds 1-14 fixed ~230 findings; this round is the zero-discovery check.',
  'READ-ONLY: do not modify any repository file, do not leave scratch files. Write only to your output path.',
  'Every finding needs file:line and a minimal failure scenario. For each suspicion, adjudicate TRUE or FALSE explicitly.',
  'If you find nothing, say exactly that - a clean lane is a claim, not an absence.',
  '',
  'The wave under review (all landed since round 14):',
  '- Lazy dialog surfaces: src/client/src/components/lazySurfaces.ts (+test), PiWebApp wiring, chunk-failure reporting.',
  '- Collapsed composer affordance: src/client/src/components/PromptEditor.ts .expand-composer (solid, squared, chevron).',
  '- Phone single-bar fold: src/client/src/components/appShell/AppNavigationPanel.ts compact header/session/working/fold + .compact-actions-row; PiWebApp hides app-context-bar on phone nav view.',
  '- Reading-edge role token: src/client/index.html --pi-reading-edge (16 desktop / 10 phone), shared.ts section, AppNavigationPanel tools-section, readingEdge.test.ts.',
  '- Session prefetch: src/client/src/components/SessionList.ts onPrefetch, AppNavigationPanel onPrefetchSession, sessionController.prefetchSession.',
  '- In-flight read sharing: src/client/src/api/inFlight.ts, http.ts shareInFlight path.',
  '- Cache eviction: src/client/src/chatHistoryCache.ts HistoryStorage injection, fitToEntry, evictionOrder, chatHistoryCacheQuota.test.ts.',
  '- Docs: docs/design/phone-quality.md, docs/design/operation-model.md, docs/design/surfaces-as-plugins.md, docs/design/review-triage-uiux-rounds-8-14.md.',
  '',
  'Hunt list (find defects, not praise): pointer-query order regressions in new rules; box-model violations in new rules; touch floors in the fold/actions row; spacing/type literals that bypass the scales; the fold state surviving section switches (stale UI state); prefetch firing on archived rows or leaking errors; in-flight sharing racing with abort or parsing; lazy surfaces warm path defeating the split; composer collapse re-expanding wrongly after ask submission.',
].join('\n');

var laneA = runs.run('lane-a', {
  agent: 'design-reviewer-d', timeoutMs: 5400000, label: 'round15 glm A', output: '/tmp/r15-lane-a.md',
  task: CONTEXT + '\n\nYOUR FOCUS: geometry and contracts - pointer-query order, box model, touch floors, spacing/type literals in the new rules, and the fold state lifecycle across section switches.',
});
var laneB = runs.run('lane-b', {
  agent: 'design-reviewer-e', timeoutMs: 5400000, label: 'round15 glm B', output: '/tmp/r15-lane-b.md',
  task: CONTEXT + '\n\nYOUR FOCUS: behavior and data - prefetch correctness (archived rows, error leaks, dedup interaction), in-flight sharing races, lazy surface warm/await paths, chunk-failure reporting honesty, cache eviction edge cases.',
});
var laneC = runs.run('lane-c', {
  agent: 'qwen-parity-reviewer', timeoutMs: 5400000, label: 'round15 qwen full', output: '/tmp/r15-lane-c.md',
  task: CONTEXT + '\n\nYOUR FOCUS: full pass, no split. Read the wave files end to end and hunt anything the split-focus lanes would miss: cross-file inconsistencies, dead rules, docs claiming what code does not do, and the composer collapse lifecycle after an ask is submitted.',
});
var results = await Promise.all([
  laneA.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneB.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneC.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
]);
return results.map(function (r, i) { return { lane: ['A', 'B', 'C'][i], ok: r !== null && !('failed' in Object(r)) }; });
