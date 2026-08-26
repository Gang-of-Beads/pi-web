/**
 * Which panes a file browser's split should show.
 *
 * The split gave the tree a third of the height and the viewer the rest, at
 * every size. With nothing selected there is no second pane to show, so that
 * left a short tree above a large empty area - two stretches of empty space
 * stacked on top of each other, most visible on a phone.
 */
export function filesSplitClass(selectedPath: string | undefined): string {
  return selectedPath === undefined || selectedPath === "" ? "split list-only" : "split";
}
