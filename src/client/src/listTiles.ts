import type { ListTilesPerRow, PiWebListTilesConfig } from "../../shared/apiTypes";

/** PI WEB's two layouts: phone pages, or the desktop's sidebar beside the conversation. */
export type ListLayout = "phone" | "desktop";

/**
 * What a layout's lists show when nobody has chosen (owner, ask `cb9e31f7`: keep today's): two
 * per row on a phone, one in the desktop sidebar. Until a choice is made, the width rule still
 * draws a wide page (the desktop overlay) with as many as fit.
 */
const TODAYS_TILES: Readonly<Record<ListLayout, ListTilesPerRow>> = { phone: 2, desktop: 1 };

/**
 * Tiles per row in the Navigate lists for a layout, or undefined for the width rule
 * (docs/design/list-layout.md). The choice is kept in PI WEB's config, one per layout, so it
 * survives clearing the browser's data and a phone and a desktop still differ.
 */
export function chosenListTiles(config: PiWebListTilesConfig | undefined, layout: ListLayout): ListTilesPerRow | undefined {
  return config?.[layout];
}

const WITH_CHOICE: Readonly<Record<ListLayout, (config: PiWebListTilesConfig, tiles: ListTilesPerRow) => PiWebListTilesConfig>> = {
  phone: (config, tiles) => ({ ...config, phone: tiles }),
  desktop: (config, tiles) => ({ ...config, desktop: tiles }),
};

/** The config with one layout's choice set, the other layout's kept. */
export function withListTiles(config: PiWebListTilesConfig | undefined, layout: ListLayout, tiles: ListTilesPerRow): PiWebListTilesConfig {
  return WITH_CHOICE[layout](config ?? {}, tiles);
}

/** The option Settings marks: the choice, or what the layout shows today. */
export function shownListTiles(config: PiWebListTilesConfig | undefined, layout: ListLayout): ListTilesPerRow {
  return chosenListTiles(config, layout) ?? TODAYS_TILES[layout];
}
