import type { PluginListGroup, PluginListModel, PluginListRead, PluginListWords } from "../../../../shared/pluginApiTypes";

/**
 * What a status page shows for its list model, decided in one place.
 *
 * A page with rows shows them, with the stale line above them when the latest
 * read failed: a failed read keeps what an earlier read found and says so. A
 * page with nothing to show draws one box carrying the words for its read
 * state, so "nothing yet", "nothing" and "could not read" never collapse into
 * one blank page (absence is not negation).
 */
export type PluginListView =
  | { readonly kind: "rows"; readonly groups: readonly PluginListGroup[]; readonly banner: string | undefined }
  | { readonly kind: "box"; readonly text: string };

const BOX_WORDS: Readonly<Record<PluginListRead, (words: PluginListWords) => string>> = {
  reading: (words) => words.reading,
  ready: (words) => words.empty,
  failed: (words) => words.failed,
};

const BANNER_WORDS: Readonly<Record<PluginListRead, (words: PluginListWords) => string | undefined>> = {
  reading: () => undefined,
  ready: () => undefined,
  failed: (words) => words.stale,
};

function groupShows(group: PluginListGroup): boolean {
  return group.rows.length > 0 || (group.actions?.length ?? 0) > 0;
}

export function pluginListView(model: PluginListModel): PluginListView {
  const groups = model.groups.filter(groupShows);
  if (groups.length === 0) return { kind: "box", text: BOX_WORDS[model.read](model.words) };
  return { kind: "rows", groups, banner: BANNER_WORDS[model.read](model.words) };
}
