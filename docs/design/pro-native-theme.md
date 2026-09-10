# Pro native: the app's own look, themes as departures from it

## Decisions (owner, round 31)

1. **The native UI is the pro style.** Without a theme extension the app
   renders the flat mono TUI look - this is not a toggle, it is the default
   the core ships. With the official themes extension installed, the default
   is still pro; clay and the other soft looks are opt-in.
2. **The theme contract carries shape/typography tokens.** Colours alone
   would render a soft palette on the pro skeleton - half of another theme.
   The contract gains optional stops: `--pi-font-ui`, `--pi-font-display`,
   `--pi-font-mono`, and the radius scale `--pi-radius-xs..xl`. A theme
   that omits them inherits the core's pro shape; the official pack pins the
   soft shape it was designed with.
3. **Full TUI strength**: the mono stack is the UI face (display follows),
   radii collapse to 0/1/2/3/4px, elevation composes from transparent shadow
   colours so every box-shadow in the app goes flat without touching the
   component rules that consume them. The pill token keeps rounding dots.
4. **The 44px coarse touch floor stands.** Pro changes face and corners,
   not the reach contract; the touch probe still passes with recorded
   exemptions only.
5. **No key-hint UI yet** - the custom-shortcut panel already exists; hint
   bar, cheat sheet and modal navigation stay future work.

## Mechanics

- `core:pro` is a sentinel preference, not a plugin theme: selecting it
  removes every theme token from the root and lets index.html's defaults
  stand. The appearance panel lists it first; the way back is always the
  top card.
- `applyNativeProTheme` is the inverse of `applyPiWebTheme`: same token
  list, cleared instead of set, so a soft theme switching back to pro
  restores the mono face and the square corners rather than keeping the
  last theme's shape.
- Density: the control heights and the spacing scale are untouched this
  round - the floors are load-bearing and the mechanical guards pin them.
  Tightening is a later, separate call.
