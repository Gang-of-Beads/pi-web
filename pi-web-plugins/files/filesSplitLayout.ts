export function filesSplitClass(selectedPath: string | undefined): string {
  return selectedPath === undefined || selectedPath === "" ? "split list-only" : "split";
}
