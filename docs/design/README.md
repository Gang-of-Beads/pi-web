# Design

How PI WEB is built and why. These documents are the design of record; code cites them for the reasons behind its shape.

## The authorities

- [State diagram](state-diagram.md): the rules, the state machines D1–D8 and the bug index. Every new state is added here, with its reason, before code.
- [Object model](object-model.md): every object's properties, scope key, owner, head, events, cache and retention; the one read lifecycle; the network plan and the migration phases.
- [Sync that converges](sync-convergence.md): heads per surface and how a page catches up.
- [State synchronisation redesign](state-sync-redesign.md): one FIFO, facts not copies.

## Current designs

- [Long press selects: one bulk mode for every list](bulk-selection.md): selection on every list with actions, with the states it adds.
- [Extension screens: native when declared, a parsed card otherwise](extension-screens-plugin-entry.md): how an extension's `ui.custom` screen renders.
- [The navigation state machine](navigation-state-machine.md): places and transitions of the app shell; the state diagram's D8 indexes its bugs.
- [PI WEB gives the agent no tools of its own](no-builtin-agent-tools.md): why the daemon registers no agent tools, and where delegation lives instead.
- [One message, one row](one-message-one-row.md): how duplicate message rows are made unrepresentable.
- [Plugin architecture: a minimal core, everything else a plugin](plugin-architecture.md): the core and plugin boundary the plugin system is built on.
- [Plugin lifecycle hooks, and Subagents as an official plugin](plugin-lifecycle-and-subagents.md): enabling and disabling plugins live, and moving Subagents out of core.
- [Pro native: the app's own look, themes as departures from it](pro-native-theme.md): the default look, and what a theme may change.
- [Surfaces as plugins, and one official plugin pack](surfaces-as-plugins.md): declarative contributions and the official plugin pack.
- [Transcript status bar, and one gutter rule](transcript-status-strip.md): where a plugin's status shows, and the transcript's margins.
- [Wave 0: the web plugin runtime and the seams it adds](web-plugin-runtime.md): plugins that run in the web process, and the routes they mount.

## Records

- [reviews/](reviews/): one triage record per reviewed change or design. Every review finding has a written verdict (fixed, not fixed with a reason, or judged not true).
- [history/](history/README.md): plans, research, audits and wave records that later designs replaced. Kept so the reasons stay readable.
- Notes outside the design: [docs/notes](../notes/README.md).
