# Frontend component-library options

A survey of off-the-shelf UI component libraries, and how they would fit PI WEB.
This is a decision record, not a commitment: the goal was to answer "can we stop
maintaining this UI detail ourselves?"

## Where the pain is

The frontend is hand-rolled Lit web components. The recurring bugs in this
project - dialog content scrolling past the fold, missing focus trapping,
undersized touch targets, zoom controls - are the long tail of UI detail that
every component library solves once. The question is whether adopting one is
cheaper than continuing to fix details by hand.

## Hard constraints

- The app is Lit + shadow DOM + CSS custom properties (`--pi-*` tokens). A
  library that is not framework-agnostic (React/Vue/Svelte-only) is out.
- The UI is fully themable through CSS custom properties. The library must not
  require semantic tokens to be reinvented in every component; it must accept
  overrides through its own token layer.
- The app ships as a built asset served by its own server; library assets must
  bundle, not assume a CDN.

## Candidates

| Library | Built with | Dialog/focus-trap | Theme via CSS vars | Maintenance | Fit |
|---|---|---|---|---|---|
| **Web Awesome** (`@awesome.me/webawesome`, ex-Shoelace) | Lit | Yes (dialog, focus trap, overlay click) | Yes, token-driven | Active; Shoelace is officially sunset in its favour | **Best** |
| Zinc (`@zinc-ui/zinc-ui`) | Lit | Yes | Yes | Active, ~3.x | Good |
| HELiX (`@bookedsolidtech/helix`) | Lit 3.x | Yes | W3C design tokens | Active, enterprise | Good but heavier |
| Fast (`@microsoft/fast`) | Web Components | Partial | Yes | Maintenance slowed | Acceptable |
| Radix / shadcn | React | - | - | - | Out (React-only) |

Notes from the survey:

- **Shoelace is sunset** (no active development, banner says "visit
  webawesome.com"). Any migration path should target Web Awesome directly.
- Web Awesome's dialog component natively handles the exact class of bug seen
  in this repo: content bounded inside the card, focus trapped, Esc and
  overlay-click to close, keyboard navigation through options.
- All Lit-based candidates integrate by element registration; adoption can be
  incremental (one component at a time) without a rewrite.

## Recommendation

**Adopt Web Awesome incrementally, starting with the dialog/alerts surface.**
The highest-value first step is replacing the hand-rolled modal/dialog layer
(image zoom, activity output, extension dialogs) with the library's dialog
components, because:

1. The bugs reported in this session - long dialog content pushing controls
   off screen, non-scrollable cards - are structural in hand-rolled dialogs.
2. The library's dialog is token-themable (`--wa-*` custom properties map onto
   the app's `--pi-*` layer), so visual language is preserved.
3. Web Components compose with existing Lit code with no framework change.

The rest of the component set (buttons, inputs, option lists) is lower value
to migrate and can follow later if the dialog migration proves out.

## Costs and risks

- Bundle size: Web Awesome adds a dependency; tree-shaking keeps used components
  only, but expect a real payload increase over the hand-rolled pieces.
- Token mapping: the app's `--pi-*` tokens must be aliased to `--wa-*` names.
  This is mechanical but touches the design-token layer.
- Shadow-DOM style override: component internals are styled via `::part()`
  and tokens; a few components may need `::part()` hooks that the current
  hand-rolled CSS gained for free.

## Decision

Recorded 2026-08-25. Recommendation is Web Awesome, incremental, starting
with dialogs/alerts. Not yet implemented; requires follow-up UI work to adopt.