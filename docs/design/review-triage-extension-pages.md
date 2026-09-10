# Extension pages: what exists today, and whether the design holds

Question from the owner: can an extension add its own pages? Two glm lanes
(inventory + design review) against the current HEAD.

## The answer

**Not as a contract term.** The contribution vocabulary has no `pages`/
`views` type. What exists is a de-facto half-page: a workspace panel can be
promoted to the main view (`?view=<pluginId>:<panelId>`, deep-linkable,
reload-safe - the route resolver loads that machine's plugins before
resolving), pushed fullscreen over the whole canvas, and given per-machine
memory on switch-and-return. On a phone the panel already fills the screen.
The one plugin surface outside the workspace scope that deep-links is a
settings section (`?settings=<id>`).

What an extension **cannot** do today: declare an SPA path route (unknown
paths fall back to index.html; routing reads search params only), claim any
machine- or global-level page slot, or persist a dialog across reload.

## Design verdict (lane B, ratified by the inventory)

**Short term the panel-as-page compromise is correct and stays** - zero new
API, deep links work, per-machine memory works. **As the end state it is
FALSE**: it presses three different contracts (column tool, main view,
addressable page) into one contribution type, and both heaviest bundled
plugins hand-rolled page fragments outside the contract to cope - git built
its own route class, raw pushState, its own popstate listener and a
hard-coded read of the host's query namespace; files grew its own
namespaced-query state.

## The recorded seams (fixed only on the owner's call)

1. **Unknown/dangling view silently renders the first panel**
   (WorkspacePanel.ts:33 `?? visiblePanels[0]`) - violates absence-is-not-
   negation; a dangling deep link shows the wrong page with no word of it.
2. **Workspace switch never re-resolves mainView** - the URL's page quietly
   becomes a different page after a switch.
3. **Three URL writers, two styles, one bypass** - host writeRouteUrl
   (merged, debounced) vs git's raw pushState vs per-plugin popstate.
4. **ui.query namespaces have no ownership or scope clearing** - any string
   accepted; files writes into the core's own namespace; nothing clears
   plugin keys on scope switch.
5. **Fullscreen is one unkeyed global bit** with its recovery invariant
   spread across three sites.
6. **Focus**: openWorkspaceTool/selectMainView have none, unlike the quick
   switcher's full discipline.
7. **Remote plugin deep links embed hex machine ids** - unreadable, and the
   failure mode is seam 1's silent substitution.

## Minimal honest path when the owner wants it (no new contribution type)

Unknown-view state first (honesty), then a query-namespace registry with
scope clearing, then a single URL writer. A second workspace-independent
consumer is the YAGNI gate for a real `views` contribution - and that day
the scope axis (machine vs project vs workspace) must be named in the type,
because it is the deepest crack in the current compromise.

Research: docs/design/research/extpages-lane-a.md (inventory),
extpages-lane-b.md (design review).
