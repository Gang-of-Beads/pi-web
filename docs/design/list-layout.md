# List layout: one or two tiles per row

Status: owner request 2026-10-06; rulings so far (ask `22390e91`): the choice lives in Settings →
Appearance, the three lists switch together, plugins may customise. Storage, the default and what
"plugins customise" covers are open (below).

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

## Proposal

- Settings → Appearance → **Lists**: "One per row", "Two per row", and "Fit the width" (today's
  rule), kept per layout (phone, desktop) when storage 3 is chosen.
- The choice applies to Sessions, Machines and Projects together, and to every place the Navigate
  page is drawn (phone pages and overlay, desktop sidebar and overlay). On a wide overlay "One per
  row" draws full-width rows and "Two per row" two columns.
- Plugins: the host hands the choice to plugin lists (`NavSectionDisplay.columns`), so the
  workspaces plugin's sections follow it; a plugin may fix its own list's layout when its rows only
  read one way. The host never re-lays a plugin's list itself.
- One classifier names the column count from (choice, layout, list width); tiles keep their shape
  and the coarse-pointer floors whatever the count.
