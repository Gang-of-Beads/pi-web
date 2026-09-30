# UI foundation: what to adopt, what to build

Research note for the visual round. Decided 2026-08-20, on branch
`redesign/ia-and-multi-machine`.

## Question

Can an existing component library or CSS framework make this UI look better,
faster than building a visual language of our own?

## Answer

No library, but three systems: design tokens, an icon set, and native overlay
positioning. The reasons are specific to this codebase, not general taste.

## Why a component library does not fit

**Shadow DOM rules out global CSS frameworks.** The client is ~90 Lit
components, each with its own shadow root. Tailwind, daisyUI and Bootstrap all
depend on a global stylesheet, which does not cross a shadow boundary. The two
workarounds are injecting the framework's stylesheet into every shadow root (a
copy per root, plus build and runtime machinery) or dropping shadow DOM
altogether. Both cost more than they return here.

CSS custom properties *do* inherit through shadow boundaries, which is why the
existing `THEME_TOKENS` approach works. That is the seam to build on.

**The libraries that are left are either unmaintained or the wrong 20%.**

| Candidate | Status (Aug 2026) | Verdict |
|---|---|---|
| Material Web (`@material/web`) | "in maintenance mode pending new maintainers" (repo README) | Rejected: no maintainer for a long-lived tool |
| Shoelace | Sunset; last release 2.20.1, March 2025 | Rejected: superseded |
| Web Awesome 3.x | Active, MIT core (~70 components), 11 themes, cascade layers, CSS-variable theming | Viable, but see below |
| Spectrum / Carbon / Fluent | Active, but each carries a strong corporate identity | Rejected: identity is the thing we want to own |

Web Awesome is the only serious candidate. It is still the wrong trade *as a
whole*: the surfaces that fill this app - the chat transcript, the session tree,
the terminal, the CodeMirror composer, the workspace panels - are not in any
component library. What a library would replace is buttons, dialogs and menus,
roughly a fifth of the interface, in exchange for a full-app migration, a few
hundred KB, and the recognisable look of that library. The brief is a visual
identity of our own, so paying a migration to arrive at someone else's default
is the wrong direction.

Exception worth keeping open: a single fiddly input (combobox, date picker) can
be imported from Web Awesome on its own if we ever need one. MIT, per-component
imports, no all-or-nothing.

## What actually makes the current UI read as ugly

Not missing components:

1. **Borrowed palette.** The classic theme is the GitHub dark default
   (`#0d1117`, `#58a6ff`); the pi-web themes vary the hue but keep the same
   structure. Nothing about it says what this product is.
2. **No scale.** Spacing and type values are ad hoc across `shared.ts`
   (5, 6, 7, 8, 9, 10, 12, 14px, all hand-picked), so nothing lines up and
   density reads as accidental rather than chosen.
3. **Flat hierarchy.** Every control has the same border, radius and weight, so
   the eye has nothing to follow and dense screens (the sidebar, the mobile tool
   strip) read as noise.
4. **Hand-drawn icons.** `tabIcons.ts` and `promptEditorIcons.ts` are bespoke
   paths with inconsistent stroke weight and optical size.

None of those are fixed by importing components; all of them are fixed by
deciding a system and applying it.

## Adopt

1. **Token layer (build).** An OKLCH-based palette with contrast-audited ramps,
   plus explicit scales for type, space, radius, elevation and motion, extending
   the existing `THEME_TOKENS` into semantic layers (surface/edge/content/state)
   rather than the current flat list. Generators: oklch.xyz, Evil Martians'
   Harmonizer. Open Props is a useful reference for scale ratios and shadow
   recipes; not needed as a dependency, since we publish our own `:root` values
   already.
2. **Icon set (adopt).** Lucide (ISC): one consistent stroke system, inlined per
   icon at build time, no runtime. Phosphor is the alternative if we want
   multiple weights as a design device.
3. **Overlay positioning (adopt the platform).** Replace the hand-rolled
   `getBoundingClientRect` maths in `components/actionMenu.ts` with the Popover
   API plus CSS anchor positioning: top layer means no clipping by scroll
   containers, and `position-try` handles flipping. Support as of 2026: Chrome
   125+, Safari 26+, Firefox 147+.
   **Constraint that decides the design:** anchor positioning does not cross
   shadow root boundaries. Our menu panel and its trigger live in the same
   shadow root, so this works - but any future overlay rendered into a different
   root must keep explicit positioning or use the oddbird polyfill.
4. **Typography (adopt fonts, own the pairing).** Self-hosted variable fonts so
   the PWA works offline: a UI face, a display face used with restraint for
   identity, and a mono that agrees with the xterm terminal.

## Consequences

- No new runtime dependency is required for the visual round; icons are inlined
  and the overlay work removes code rather than adding it.
- Theming keeps working exactly as it does today (plugin-contributed themes,
  `auto` pairing), because everything still lands on CSS custom properties.
- The one migration cost is rewriting component styles against the new scales,
  which the visual round has to do anyway.

## Sources

- Web Awesome vs Shoelace, incl. Shoelace sunset and Web Awesome licensing:
  <https://blog.fontawesome.com/how-does-web-awesome-stack-up-against-shoelace/>
- Material Web maintenance mode: <https://github.com/material-components/material-web/>
- CSS anchor positioning support table: <https://caniuse.com/css-anchor-positioning>
- Anchor positioning and shadow DOM: <https://anchor-positioning.oddbird.net/shadow-dom>
- Tailwind in shadow DOM (the injection workaround):
  <https://www.viget.com/articles/embeddable-widgets-with-vite-react-tailwind-4-web-components>
