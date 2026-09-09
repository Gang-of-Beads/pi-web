const CONTEXT = [
  'PI WEB is a phone-first web client for the pi coding agent. The owner says the UI feels awkward',
  'while loading and while being operated: things stall and then appear, instead of the modern pattern',
  'where a surface renders once and then updates in place. He wants it to feel like a real web product.',
  '',
  'This is READ-ONLY analysis. Do not modify any file. Write only to your output file. Every claim needs',
  'a file:line from this repository. Where you cannot verify something, write NOT VERIFIED rather than',
  'guessing. Do not leave probe scripts or scratch files in the repository.',
  '',
  'Already known and being acted on (do not re-report as new):',
  '  - chatHistoryCache.ts swallows the sessionStorage quota error with no eviction, so large',
  '    transcripts are never cached.',
  '  - The entry bundle is one 1,016,264-byte chunk; there is no route or feature splitting.',
  '  - There is no in-flight request dedupe in the client API layer and no prefetch on intent.',
  '  - docs/design/orca-study.md records the borrows already chosen from a comparable product.',
].join('\n');

const laneWaterfall = () => runs.run('ui-waterfall', {
  agent: 'design-reviewer-d',
  timeoutMs: 5400000,
  label: 'load waterfall',
  output: '/tmp/ui-waterfall.md',
  task: [
    CONTEXT,
    '',
    'YOUR LANE: the loading waterfall, from first paint to a usable session.',
    'Trace every await between opening the app and being able to type into a session: which requests',
    'are sequential that could be concurrent, which surfaces wait for data they do not render, which',
    'render an empty frame before data arrives, and where a spinner replaces content that was already',
    'on screen. Name each blocking step with file:line and say what it is waiting for. Then rank the',
    'steps by how much wall-clock they add on a cold open and on a session switch, and mark each as',
    'removable, parallelisable, or genuinely sequential. Read src/client/src/controllers/*.ts,',
    'appShell/*.ts, api/*.ts and PiWebApp.ts boot paths.',
  ].join('\n'),
});

const laneStateChurn = () => runs.run('ui-state-churn', {
  agent: 'qwen-parity-reviewer',
  timeoutMs: 5400000,
  label: 'state churn',
  output: '/tmp/ui-state-churn.md',
  task: [
    CONTEXT,
    '',
    'YOUR LANE: what the UI throws away and rebuilds, versus what it updates in place.',
    'Find every place a surface discards rendered state and starts over: state resets on selection',
    'change, caches keyed too coarsely or too finely, list re-keying that drops DOM identity, loading',
    'flags that blank a panel that already had content, and data refetched on every visit that could be',
    'served stale and revalidated. For each: file:line, what the user sees, and whether the reset is',
    'protecting a real invariant (say so plainly if it is - this project has a rule that a cached value',
    'must never render under a different key). Finish with the ones that are safe to convert to',
    'render-once-then-update, and the ones that are not, with the reason.',
  ].join('\n'),
});

const laneInteraction = () => runs.run('ui-interaction', {
  agent: 'design-reviewer-e',
  timeoutMs: 5400000,
  label: 'interaction feel',
  output: '/tmp/ui-interaction.md',
  task: [
    CONTEXT,
    '',
    'YOUR LANE: what happens between a tap and the result.',
    'For the actions a person performs most - switching machine, project, workspace and session,',
    'sending a message, opening settings, opening a file, running a command - record from the source:',
    'is there immediate feedback on press; is the result optimistic or does it wait for a round trip;',
    'what does the surface show while waiting; can the action be repeated or cancelled; what happens on',
    'failure; and does the surface move under the finger after the fact arrives. Cite file:line.',
    'Then name the three interactions whose felt latency is worst and say exactly what would change',
    'them, distinguishing work that is genuinely slow from work that only looks slow.',
  ].join('\n'),
});

const results = await Promise.all([laneWaterfall(), laneStateChurn(), laneInteraction()]);
return {
  lanes: results.map((value, index) => ({ lane: index + 1, ok: value !== null })),
  files: ['/tmp/ui-waterfall.md', '/tmp/ui-state-churn.md', '/tmp/ui-interaction.md'],
};
