# Frontend component-library options

A survey of off-the-shelf UI component libraries, and how they would fit PI WEB.
This is a decision record, not a commitment: the goal was to answer "can we stop
maintaining this UI detail ourselves?"

## What a component library does and does not fix

This distinction drives the whole recommendation, so it comes first.

A component library supplies **mechanics**: a dialog that traps focus, a
dropdown that flips when it hits the viewport edge, a tree that implements
roving tabindex. These are solved problems with fiddly edge cases, and hand
writing them is where this project's UI bugs have come from.

A component library does not supply **hierarchy**. A session list whose parent
and child rows use identical size, weight and colour reads as flat no matter
whose components draw it. A section header showing a bare unlabelled count is
unclear in any library. Adopting a library and keeping the current composition
decisions produces the same incoherence with a different button style.

So the two problems are separate and need separate work:

| Symptom | Cause | Fix |
|---|---|---|
| Dialog content scrolls past the fold; missing focus trap; small hit targets | Hand-rolled mechanics | Component library |
| Parent and child rows look equally important; bare `1` next to a heading; disclosure control hidden in a corner | No hierarchy rules | Design-system discipline |

## Hard constraints

- The app is Lit + shadow DOM + CSS custom properties (`--pi-*` tokens). A
  library that is not framework-agnostic (React/Vue/Svelte-only) is out. This
  eliminates Radix, shadcn, Material UI, Mantine, Chakra and Ark.
- The app ships as a published npm package, so the licence must permit
  commercial redistribution without a per-seat fee.
- The UI is fully themable through CSS custom properties. The library must
  accept overrides through its own token layer rather than requiring semantic
  tokens to be reinvented per component.
- Library assets must bundle; a CDN assumption is not acceptable.

## Candidates

| Library | Built with | Licence | Status | Fit |
|---|---|---|---|---|
| **Web Awesome Core** (`@awesome.me/webawesome`, ex-Shoelace) | Lit | **MIT** | Active; successor to Shoelace | **Best fit** |
| Web Awesome **Pro** | Lit | Paid, per-Creator | Active | Not needed; Core is sufficient |
| Shoelace (`@shoelace-style/shoelace`) | Lit | MIT | **Sunset**; last release Mar 2025, redirects to Web Awesome | Out for new adoption |
| Material Web (`@material/web`) | Lit | Apache-2.0 | **Maintenance mode** — Google reassigned the engineers to the internal Wiz framework | Out |
| Spectrum Web Components (Adobe) | Lit | Apache-2.0 | Active | Viable, but imposes Adobe's visual language |
| Carbon Web Components (IBM) | Lit | Apache-2.0 | Active | Viable, but imposes IBM's visual language |
| Zinc (`@zinc-ui/zinc-ui`) | Lit | MIT | Active | Smaller ecosystem |
| Headless web-component primitives | Web Components | Varies | Emerging | Behaviour only, no visual opinion |
| Fast (`@microsoft/fast`) | Web Components | MIT | Maintenance slowed | Acceptable, declining |
| Radix / shadcn / MUI | React | - | - | Out (React-only) |

### Licence findings

- **Web Awesome Core is MIT.** Fonticons publishes the core components and
  themes as open source; the paid Pro tier adds extra asset packs, premium
  component variants and online services. Nothing in the core set requires
  payment, so a published npm package can depend on it.
- **Material Web is in maintenance mode.** The team announced that Material
  Design reassigned its engineers to Google's internal Wiz framework. It is not
  archived, but it is not being developed. Adopting it now buys a dependency
  with no roadmap.
- **Shoelace is sunset** in favour of Web Awesome; any migration should target
  Web Awesome directly rather than routing through Shoelace.

## Recommendation

Two tracks, in this order.

### Track 1 — hierarchy rules (no dependency)

This is where the current "does not look designed" impression actually comes
from, and it can be fixed without adopting anything. Adopt the discipline that
dark developer tools such as Linear use: **surface lift and hairline borders
carry hierarchy, not font size.** Concretely:

- A surface ladder of a few fixed steps, applied consistently, instead of
  per-component background choices.
- One chromatic accent, reserved for selection, focus, and one primary action.
- Hierarchy between a parent row and a nested row expressed through weight,
  colour and surface, with indentation as a secondary cue rather than the only
  cue.
- Counts and status carry a label or a shape; a bare numeral beside a heading
  states nothing.

The `--pi-*` scale already exists and is guarded by `designTokens.test.ts`
(9 spacing steps, 7 type sizes, 6 radii). The gap is not the scale, it is the
absence of rules for *which* step to use, so the same visual weight gets built
three different ways.

### Track 2 — Web Awesome Core, incrementally, starting with dialogs

The highest-value first step is replacing the hand-rolled modal/dialog layer,
because those bugs are structural rather than cosmetic: content pushing controls
off screen, absent focus trapping, nested scroll regions. Web Awesome's dialog
handles bounded content, focus trap, Esc and overlay-click natively, and is
token-themable, so `--pi-*` can drive `--wa-*` and the visual language is
preserved. Buttons, inputs and option lists are lower value and can follow.

## Costs and risks

- **Bundle size.** Tree-shaking keeps only used components, but expect a real
  payload increase over the hand-rolled pieces.
- **Token mapping.** `--pi-*` must be aliased onto `--wa-*`. Mechanical, but it
  touches the design-token layer that the token test guards.
- **Shadow-DOM overrides.** Component internals are styled via `::part()` and
  tokens; a few places may need `::part()` hooks that hand-rolled CSS had for
  free.
- **A library is not a redesign.** Adopting Web Awesome without Track 1 changes
  which components draw the UI without changing how coherent it looks.

## Decision

Revised 2026-08-26. Earlier revision (2026-08-25) recommended Web Awesome but
had not established the licence position, had not recorded that Material Web is
in maintenance mode, and treated the problem as purely a library choice.

Current position: **Track 1 first** (hierarchy rules, no dependency), then
**Web Awesome Core** incrementally from the dialog layer. Neither is
implemented yet.
