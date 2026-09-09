const BRIEF = [
  'Study the open-source project stablyai/orca on GitHub and report what PI WEB should learn from it.',
  '',
  'How to get the source: clone it yourself with bash, for example',
  '  git clone --depth 1 https://github.com/stablyai/orca /tmp/orca-study-<lane> 2>&1 | tail -3',
  'If the clone fails, say so plainly and fall back to reading whatever you can reach; never invent',
  'file paths or code you did not read. Every claim about orca must carry a file:line from the clone.',
  '',
  'Context you are advising (read these before concluding, they are the thing being improved):',
  '  - docs/design/operation-model.md — the diagnosis of our current network/message model',
  '  - src/client/src/api/requestDeadline.ts, src/client/src/api/http.ts — request deadlines',
  '  - src/client/src/sessionSocket.ts, src/client/src/socketLiveness.ts — the realtime channel',
  '  - src/client/src/messageDelivery.ts, src/client/src/commandLedger.ts — the two state machines',
  '  - src/client/src/chatHistoryCache.ts, src/client/src/transcriptLoadingOwnership.ts — caching today',
  '  - src/server/daemon/** and src/server/web/** — the two-process split',
  '',
  'The owner\'s framing, in his words: orca\'s management side is written well but its chat UI is weak;',
  'PI WEB has native pi support, so we want to borrow its other designs. He also asked specifically for',
  'caching, lazy loading and prefetching that make the UI feel silky.',
  '',
  'Report format: numbered findings. Each one states',
  '  - what orca does (file:line in the clone),',
  '  - what PI WEB does today (file:line in this repo),',
  '  - whether it is worth borrowing, with the cost, and what it would touch here,',
  '  - and, when you are not sure, say NOT VERIFIED rather than guessing.',
  'Rank by value to us. Say plainly when orca is worse than what we have; that is a finding too.',
  'Do not modify this repository. Write your report to the output file only.',
].join('\n');

const laneNetwork = () => runs.run('orca-network', {
  agent: 'design-reviewer-d',
  timeoutMs: 5400000,
  label: 'orca network model',
  output: '/tmp/orca-network.md',
  task: [
    BRIEF,
    '',
    'YOUR LANE: the network and operation model.',
    'Look for: how a client action is identified end to end; whether the server keeps an operation or',
    'event log and how a reconnecting client catches up; idempotency and retry semantics; how it',
    'distinguishes "sent", "accepted", "running", "lost" and "cancelled"; timeouts and how they relate',
    'to liveness; websocket/SSE/polling choices and their failure handling; queueing and backpressure;',
    'what it does on a flaky link so the user is never blocked or lied to. Then say concretely which of',
    'those we should adopt for the operation model in docs/design/operation-model.md and which of our',
    'three options (A full ledger / B correlate-and-honest / C honesty patch) its evidence supports.',
  ].join('\n'),
});

const laneCache = () => runs.run('orca-cache', {
  agent: 'qwen-parity-reviewer',
  timeoutMs: 5400000,
  label: 'orca caching and loading',
  output: '/tmp/orca-cache.md',
  task: [
    BRIEF,
    '',
    'YOUR LANE: caching, lazy loading, prefetching and perceived performance.',
    'Look for: client cache shape and invalidation (per key: machine/project/workspace/session), stale',
    'while-revalidate, optimistic updates and rollback, route/code splitting, prefetch on intent',
    '(hover, focus, viewport), list virtualisation, skeleton vs spinner policy, image and transcript',
    'loading, request coalescing and deduplication, and how they keep a first paint fast. Compare each',
    'against ours (chatHistoryCache.ts, transcriptLoadingOwnership.ts, readingAnchor.ts, the plugin',
    'lazy-loading in src/client/src/plugins/) and state which specific technique would make our UI feel',
    'silky, at what cost, and what it would break.',
  ].join('\n'),
});

const laneArchitecture = () => runs.run('orca-architecture', {
  agent: 'design-reviewer-e',
  timeoutMs: 5400000,
  label: 'orca architecture',
  output: '/tmp/orca-architecture.md',
  task: [
    BRIEF,
    '',
    'YOUR LANE: overall architecture and the management surfaces the owner praised.',
    'Look for: process/service split and what owns state; how sessions, runs or jobs are modelled and',
    'controlled; configuration and multi-machine or multi-tenant handling; plugin or extension seams;',
    'auth and permission boundaries; observability, logging and how a user inspects a stuck job; the',
    'testing strategy. Compare with our two-process split (src/server/daemon vs src/server/web),',
    'our plugin runtime (src/server/shared/plugins/, src/client/src/plugins/) and AGENTS.md, and say',
    'what is genuinely better there. Note where orca is weaker than us, especially its chat surface,',
    'so we do not copy its mistakes.',
  ].join('\n'),
});

const results = await Promise.all([laneNetwork(), laneCache(), laneArchitecture()]);
return {
  lanes: results.map((value, index) => ({ lane: index + 1, ok: value !== null })),
  files: ['/tmp/orca-network.md', '/tmp/orca-cache.md', '/tmp/orca-architecture.md'],
};
