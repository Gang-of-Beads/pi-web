import type { ListTilesPerRow, PiWebListTilesConfig } from "../../shared/apiTypes";

/** PI WEB's two layouts: phone pages, or the desktop's sidebar beside the conversation. */
export type ListLayout = "phone" | "desktop";

/**
 * Tiles per row in the Navigate lists for a layout, or undefined for the width rule, which is the
 * default (owner, ask `cb9e31f7`: keep today's) and which Settings marks as no choice: marking
 * "what today shows" claimed a count the full-width page did not draw, and the marked option sent
 * nothing when tapped (review triage, list tiles) (docs/design/list-layout.md). The choice is kept in PI WEB's config, one per layout, so it
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
