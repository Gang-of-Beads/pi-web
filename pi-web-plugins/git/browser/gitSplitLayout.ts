/**
 * Which panes the git panel's split should show.
 *
 * The split gave the file list a third of the height and the diff viewer the
 * rest, at every size. With nothing selected there is no second pane to show,
 * so that left a short list above a large empty area - two stretches of empty
 * space stacked on top of each other, most visible on a phone.
 */
export function gitSplitClass(selectedDiffPath: string | undefined): string {
  return selectedDiffPath === undefined ? "git-split list-only" : "git-split";
}
