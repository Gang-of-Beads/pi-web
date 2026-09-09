const CONTEXT = [
  'PI WEB is a phone-first web client for the pi coding agent. The owner has decided the plugin',
  'direction and wants it reviewed before implementation:',
  '  1. Two contribution lists: a plugin declares where it appears (phone quick-access page, desktop',
  '     tab strip, drawer section), rather than the shell deciding.',
  '  2. Declarative down to data and operations, not only metadata, with a clean public interface.',
  '  3. Official plugins live in a NEW repository installed straight from GitHub - no npm publish yet.',
  '     The format must accept an npm package, a GitHub repo, or any file layout satisfying it.',
  '  4. Core keeps: the agent capability, session management, the network layer, a minimal UI, and the',
  '     extension machinery. Everything else becomes a plugin.',
  '',
  'READ-ONLY analysis. Do not modify any file in the repository, do not leave scratch files, and write',
  'only to your output file. Every claim needs a file:line from this repository. Say NOT VERIFIED',
  'rather than guessing.',
  '',
  'Start from: docs/design/surfaces-as-plugins.md, src/plugin-api.ts, src/server-plugin-api.ts,',
  'src/shared/pluginApiTypes.ts, src/client/src/plugins/ (registry, pluginHostUi, types),',
  'src/server/shared/plugins/, pi-web-plugins/*/ and scripts/build-plugins.mjs.',
].join('\n');

const laneBoundary = () => runs.run('plugin-boundary', {
  agent: 'design-reviewer-d',
  timeoutMs: 5400000,
  label: 'core boundary',
  output: '/tmp/plugin-boundary.md',
  task: [
    CONTEXT,
    '',
    'YOUR LANE: what stays in core and what leaves, item by item.',
    'Enumerate every surface, route, store and capability the client and the two server processes own',
    'today, and classify each as: core by the owner\'s definition (agent capability, session',
    'management, network layer, minimal UI, extension machinery), plugin, or genuinely ambiguous.',
    'For each plugin candidate say what it depends on from core, whether that dependency is already',
    'expressed through the plugin seam or would need a new capability, and what breaks if it moves.',
    'Flag anything that today reaches around the seam - a plugin importing shell internals, or the',
    'shell special-casing a plugin id. Finish with a migration order that keeps the app usable at every',
    'step, and name the items where the owner has to choose rather than you.',
  ].join('\n'),
});

const laneDeclarative = () => runs.run('plugin-declarative', {
  agent: 'qwen-parity-reviewer',
  timeoutMs: 5400000,
  label: 'declarative surface',
  output: '/tmp/plugin-declarative.md',
  task: [
    CONTEXT,
    '',
    'YOUR LANE: what a declarative contract would have to cover, derived from what our plugins actually do.',
    'Go through every bundled plugin and record, with file:line, exactly which host capabilities it uses:',
    'rendering, styles, dialogs, modals, storage, routes, operations, settings, activity/status, events,',
    'and anything it reaches for that the seam does not offer. Then group those into the smallest set of',
    'declarations that would cover them - surfaces, data sources, operations, settings, permissions -',
    'and mark which of our current imperative uses would NOT survive a declarative form, with the',
    'concrete example. Be specific about the escape hatch each hard case needs. Where our plugin API',
    'already has a baseline (test-fixtures/plugin-api-baseline), say what a declarative layer does to it.',
  ].join('\n'),
});

const laneLoading = () => runs.run('plugin-loading', {
  agent: 'design-reviewer-e',
  timeoutMs: 5400000,
  label: 'discovery and loading',
  output: '/tmp/plugin-loading.md',
  task: [
    CONTEXT,
    '',
    'YOUR LANE: discovery, installation and loading, as they exist and as they would need to be.',
    'Trace how a plugin is found, trusted, built, served and loaded today - project roots, the data',
    'directory, bundled manifests, the web process versus the daemon, the browser module URL path -',
    'with file:line for each step. Then answer concretely: what would it take to install a plugin from',
    'a GitHub repository at a ref; where trust and version pinning would live; what has to be true for',
    'a plugin to be lazily loaded only when its surface opens; and what the current build assumes that',
    'a third-party layout would violate. List the security questions this raises, plainly.',
  ].join('\n'),
});

const results = await Promise.all([
  laneBoundary().catch((error) => ({ failed: String(error).slice(0, 200) })),
  laneDeclarative().catch((error) => ({ failed: String(error).slice(0, 200) })),
  laneLoading().catch((error) => ({ failed: String(error).slice(0, 200) })),
]);
return {
  lanes: results.map((value, index) => ({ lane: index + 1, ok: value !== null && !("failed" in Object(value)) })),
  files: ['/tmp/plugin-boundary.md', '/tmp/plugin-declarative.md', '/tmp/plugin-loading.md'],
};
