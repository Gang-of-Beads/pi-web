/**
 * Files dragged onto the page.
 *
 * The owner chose (2026-10-08, ask 9a4f5699): a file can be dropped anywhere in the chat, a dashed
 * frame says so while files are over it, and a file dropped anywhere else never opens in place
 * of the app. The browser's own answer to a file dropped where no handler takes it is to navigate
 * the tab to that file, which leaves PI WEB; so every file drag on the page is claimed somewhere:
 * by the composer, by the chat around it, or refused.
 */

/** Whether a drag carries files, not text or a link. */
export function dataTransferHasFiles(data: DataTransfer): boolean {
  const items = Array.from(data.items);
  if (items.length > 0) return items.some((item) => item.kind === "file");
  return Array.from(data.types).includes("Files");
}

export function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files);
}

/** Where the dashed frame stands over an area: inside it by the inset, fixed to the viewport. */
export function fileDropFrameStyle(area: { left: number; top: number; width: number; height: number }, inset = 12): string {
  return `left:${String(area.left + inset)}px;top:${String(area.top + inset)}px;width:${String(Math.max(0, area.width - 2 * inset))}px;height:${String(Math.max(0, area.height - 2 * inset))}px`;
}

/**
 * Whether a file drag is over an area, from the enter and leave events that bubble to it.
 * Moving between the area's children enters one before it leaves the other, so the area is left
 * only when every enter has had its leave.
 */
export class FileDragDepth {
  private depth = 0;

  /** True when the drag was outside the area until this enter. */
  enter(): boolean {
    this.depth += 1;
    return this.depth === 1;
  }

  /** True when the drag is now outside the area. */
  leave(): boolean {
    this.depth = Math.max(0, this.depth - 1);
    return this.depth === 0;
  }

  reset(): void {
    this.depth = 0;
  }
}
