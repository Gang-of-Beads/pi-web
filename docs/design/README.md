# Design

Design records written during development; they cite measurements on the maintainers' instances and are not user documentation.

Code cites these documents for the reasons behind its shape. Start with the contributor overview, [PI WEB architecture](../architecture.md), for how the pieces fit together.

## The authorities

- [State diagram](state-diagram.md): the rules, the state machines D1–D12 and the bug index. Every new state is added here, with its reason, before code.
- [Object model](object-model.md): every object's properties, scope key, owner, head, events, cache and retention; the one read lifecycle; the network plan and the migration phases with their status.
- [Sync that converges](sync-convergence.md): heads per surface and how a page catches up.
- [Message states](message-states.md): a message is never lost and never fails for good; the per-device operation log.

## Current designs

- [Browser-direct machines](browser-direct-machines.md): the browser connects to each machine, with access requested and approved on the remote.
- [Long press selects: one bulk mode for every list](bulk-selection.md): selection on every list with actions, with the states it adds.
- [Show what is known at once, then move it into place](cached-first-and-motion.md): the remembered session board and list motion.
- [Archive, delete and remove act at once, with Undo](instant-actions.md): the action lifecycle, what is held, and the Undo bar.
- [Go to keys](extension-keys-in-go-to.md): pages declared by plugins, or brought by an extension's widget.
- [Extension UI](extension-ui-counterpart.md): the PI WEB counterpart of pi's `ctx.ui`.
- [Go to scopes](go-to-scopes.md): global pages and project pages.
- [The interactive card](interactive-card.md): one generic card an extension declares instead of a terminal screen.
- [List layout](list-layout.md): one or two tiles per row.
- [Navigation and session lists](navigation-lists.md): the Navigate page's menus, sections and empty states.
- [The navigation state machine](navigation-state-machine.md): places and transitions of the app shell; the state diagram's D8 indexes its bugs.
- [PI WEB gives the agent no tools of its own](no-builtin-agent-tools.md): why the daemon registers no agent tools, and where delegation lives instead.
- [pi's insertion points in PI WEB](pi-insertion-points.md): every pi extension insertion point works without a PI WEB plugin; plugins add web ones on top.
- [The PI WEB Updates plugin](pi-web-updates-plugin.md): how PI WEB updates itself, by install method.
- [Plugin lifecycle](plugin-lifecycle.md): turning a plugin on or off live, and the boundary between core and plugins.
- [One list component for plugin pages](plugin-list-component.md): the host-drawn list a status page uses.
- [Pro native](pro-native-theme.md): the app's own look, and what a theme may change.
- [Drafts](server-drafts.md): where unsent input is kept.

## Records

Superseded designs, plans, research and review triage are not kept here; they are in git history.
