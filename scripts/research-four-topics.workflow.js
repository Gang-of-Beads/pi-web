const REPO = '/Users/hanxiao.du/Desktop/vincent/projects/pi-web';
const CONTEXT = [
  'Project under study: PI WEB (' + REPO + '), a browser client + Node web/API process + a session daemon that owns long-lived Pi coding-agent sessions.',
  'Stack: Lit web components (no framework), TypeScript, Vite, WebSocket realtime, Express-style routes, a plugin architecture (browser plugins in pi-web-plugins/*/pi-web-plugin.ts, server plugins in server-plugin.ts, contributions: panels, drawer sections, nav sections, composer, settings sections, message renderers, themes, operations).',
  'Owner standing rules live in ' + REPO + '/AGENTS.md and .agents/skills/*; read them before recommending anything: no inline comments, state machines over if/else ladders, encapsulation, scope-carrying data, honest absence states, minimal chrome, coarse-pointer 44px floors, changesets, precise staging.',
  'Deliverable style: a decision-grade brief, not a listicle. Every recommendation must name the trade-off, the failure mode it prevents, and how it maps onto this codebase (concrete file/module names where you can verify them by reading the repo).',
  'Cite sources with URLs for every external claim. Prefer primary sources (specs, framework docs, engineering blogs from teams that shipped it) over content farms. Mark anything you could not verify as UNVERIFIED.',
  'Write the finished brief with your write tool to the exact path given below. Do not print the whole brief in your reply; end with a 10-line executive summary and the word DONE.'
].join('\n\n');

const brief = (title, questions, out) => [
  CONTEXT,
  'Your research topic: ' + title,
  'Questions to answer concretely:\n- ' + questions.join('\n- '),
  'Write to: ' + out
].join('\n\n');

const r1 = () => runs.run('research-performance', {
  agent: 'researcher',
  label: 'network perf sync',
  task: brief(
    'Extreme perceived performance and state synchronization for a live agent-session web client',
    [
      'What do teams shipping realtime chat/agent UIs do to make first paint of session content feel instant (streaming SSR vs skeletons vs local-first cache vs optimistic render)? What are the measured trade-offs?',
      'Sync mechanisms compared for our shape (server owns truth, many tabs/devices, long sessions with 1000s of messages): naive polling, WebSocket event stream + revision numbers, CRDT, event sourcing with resumable cursors, local-first (Replicache/Electric/Zero/PowerSync style) — cost, failure modes, and what breaks when the socket drops mid-turn.',
      'Concrete techniques for transcript-scale rendering: virtualization, windowing, incremental hydration, message chunking, bounded tool results, image lazy-load without scroll jump.',
      'Cache invalidation and scope safety: how to key cached data so a stale answer for another session/workspace can never render (this project already has a scope-carrying rule).',
      'Network resilience: reconnect/backfill protocols, idempotent message delivery, exactly-once user-message semantics, offline queueing, and how to detect and honestly report a lost run.',
      'Which of these are worth it for a self-hosted single-user-to-small-team tool, and which are over-engineering at our scale?'
    ],
    '/tmp/research-performance.md'
  )
});

const r2 = () => runs.run('research-minimal-ux', {
  agent: 'researcher',
  label: 'minimal ux product',
  task: brief(
    'Minimal, modular, extensible UI/UX: philosophy plus the productization details that make it feel finished',
    [
      'What separates minimalism that works (Linear, Things, Arc, iA Writer, Bear, Superhuman, Raycast) from minimalism that hides affordances? Name the rules those teams state publicly.',
      'How do these products decide what belongs on the primary surface vs a command palette vs settings? Any published heuristics for "core operations" selection?',
      'Speed-of-operation patterns: command palettes, keyboard-first design, progressive disclosure, single-tap phone flows, gesture budgets. What are the measured wins and the accessibility costs?',
      'Detail polish checklists real design systems use: optical vs geometric centering, icon grids, control-height scales, spacing scales, radius scales, focus states, motion budgets, coarse-pointer targets.',
      'How do mature design systems keep visual consistency mechanically (tokens, lint rules, visual regression, contract tests) rather than by review vigilance?',
      'How should a plugin-extensible product keep a coherent look when third-party plugins render UI? Survey how VS Code, Obsidian, Figma, Raycast and Slack constrain plugin visuals, and what each gives up.'
    ],
    '/tmp/research-minimal-ux.md'
  )
});

const r3 = () => runs.run('research-plugins', {
  agent: 'researcher',
  label: 'plugin extensibility',
  task: brief(
    'Plugin/extension architecture for PI WEB, including compatibility with Pi coding-agent extensions',
    [
      'Read the Pi coding agent documentation on this machine (start at /nix/store/*/node_modules/@earendil-works/pi-coding-agent/README.md and its docs/ and examples/ directories; the extensions and custom-tools docs matter most) and state precisely what a Pi extension can contribute today: tools, commands, prompts, events, and the TUI-only ui.custom surface.',
      'Given Pi extensions render TUI components (ui.custom) that a browser cannot execute, what fallback/compat strategies exist? Compare: headless contract extraction (run the extension, render its declared data in web widgets), a declarative UI schema bridge, remote-component protocols, and a "degrade to text/JSON with an honest unsupported state" path. Name the failure mode of each.',
      'How do other host/plugin ecosystems handle a plugin built for a different renderer (VS Code webviews vs terminal extensions, Obsidian mobile vs desktop plugin flags, Figma sandbox, Zed extensions/WASM)? What does each host promise and refuse?',
      'What should PI WEB\'s own plugin contract look like so it mirrors the Pi agent extension model rather than inventing a second mental model: identity, manifest, capability declaration, versioned API, contribution points, permissions/trust, per-project plugins, machine-specific plugins, storage scoping, and lifecycle.',
      'Security and isolation options for browser plugins (module import vs iframe vs worker vs shadow-DOM only), and what each costs in ergonomics.',
      'Compare against this repo\'s current contract by reading src/plugin-api.ts, src/server-plugin-api.ts, src/client/src/plugins/types.ts and docs/design/plugin-architecture.md, then list concrete gaps.'
    ],
    '/tmp/research-plugins.md'
  )
});

const r4 = () => runs.run('research-architecture', {
  agent: 'researcher',
  label: 'codebase clarity',
  task: brief(
    'Making the codebase legible and maintainable at this size and shape',
    [
      'Read ' + REPO + '/AGENTS.md and ' + REPO + '/.agents/skills/code-quality-architecture/SKILL.md and treat those rules as constraints, not suggestions; your recommendations must be compatible with them.',
      'Survey the current tree (src/server/{web,daemon,shared}, src/client/src/{components,controllers,plugins,appShell}, pi-web-plugins/*) and name where the process-ownership split is honest and where modules are drifting into god files.',
      'What structural patterns keep a Lit + Node monorepo legible: feature-sliced vs layer-sliced, module boundary enforcement (dependency-cruiser, eslint boundaries, import lint), package boundaries vs directory conventions, and where each pays off.',
      'How to make state machines and pure classifiers the norm rather than the exception (this repo already has revisionVerdict, replayDecision style classifiers) — patterns, testing discipline, and how teams enforce exhaustiveness in CI.',
      'Documentation-as-contract practice: architecture decision records, spec-driven development (this repo uses openspec), and how to keep docs from rotting.',
      'Concrete refactor candidates you can justify from the repo: name files, why they are hard to change, and the smallest cut that would help.'
    ],
    '/tmp/research-architecture.md'
  )
});

const results = await Promise.all([r1(), r2(), r3(), r4()].map(p => p.catch(e => ({ error: String(e) }))));
const out = [];
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  out.push({ lane: i + 1, error: r && r.error ? r.error : undefined, ok: !(r && r.error) });
}
return { research: out, files: ['/tmp/research-performance.md', '/tmp/research-minimal-ux.md', '/tmp/research-plugins.md', '/tmp/research-architecture.md'] };
