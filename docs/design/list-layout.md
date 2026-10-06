# List layout: one or two tiles per row

Status: built. Owner rulings 2026-10-06 (asks `22390e91`, `cb9e31f7`): the choice lives in Settings →
Appearance; the three lists switch together; it is kept in PI WEB's config, one value per layout
(phone, desktop); the options are one or two per row; the default is today's; plugin lists are left
out for now ("keep it simple").

## Today, measured on 8505

The Navigate page's list (Sessions, Machines, Projects; one body for all three) is a grid that fits
the width: tiles of at least 140 px at 430 px wide or narrower, at least 240 px above that.

| Surface | List width | Tiles per row | Tile width |
| --- | --- | --- | --- |
| Phone, 393×850 | 393 px | 2 | 186 px |
| Tablet or wide phone, 600 px (phone layout) | 600 px | 2 | 289 px |
| Phone on its side, 850×393 (desktop layout: sidebar) | 340 px | 1 | 324 px |
| Desktop sidebar, 1440×900 | 340 px | 1 | 324 px |
| Desktop Navigate overlay (keyboard shortcut), 1440 px | 1440 px | 5 | 280 px |

Screens: `/tmp/surfaces/list-two-per-row-phone.png` (today), `list-one-per-row-phone.png` (mock),
`list-two-desktop-sidebar.png` (mock: titles cut after about eight characters at 160 px),
`list-desktop-overlay.png`.

Plugin lists: the workspaces plugin draws the Projects and Workspaces sections of the context sheet
(`navSections`, already told `display.tiles`); `machineSections` is not drawn anywhere today.

## What a web app can tell about a device

It cannot recognise one. What it can keep:

1. **This browser's storage**, where the theme, folds, panel widths and pins live today: per browser
   and profile; clearing site data resets it. A phone and a laptop differ only because they are
   different browsers.
2. **PI WEB's config on the machine the browser connects to** (`config.json`): survives clearing;
   every browser shares one value, so a phone and a desktop sidebar would get the same count.
3. **That config, one value per layout**: PI WEB already decides between its phone layout and its
   desktop layout (the switch between phone pages and the sidebar), so it can keep one choice for each.
   Survives clearing, and a phone and a desktop still differ - by what the screen is, not which
   device it is. Recommended.

## As built

- Config key `listTiles: { phone?: 1 | 2, desktop?: 1 | 2 }` in the gateway's global config
  (docs/config.md, Lists). A layout without a value keeps the width rule, so nothing changes until
  someone chooses.
- Settings → Appearance → Lists: one radio pair per layout. Until a choice, each marks what that
  layout shows today (two on a phone, one in the desktop sidebar). A save sends the whole gateway
  config with the one key changed, since the write replaces every key it knows.
- `listTiles.ts` names the count from (config, layout); the Navigate page draws `tiles-1` or
  `tiles-2` over the width rule, everywhere it is drawn (phone pages and overlay, desktop sidebar
  and overlay).
- Plugin lists (the workspaces plugin's sections) are untouched.
