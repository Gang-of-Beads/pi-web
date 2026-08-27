/**
 * How much of a scroller's width its scrollbar occupies.
 *
 * A control pinned to the right edge of the conversation used a fixed distance
 * from the panel, which ignored the scrollbar: on a machine that draws a real
 * one the control sat on top of it, while here, where the scrollbar floats over
 * the content, the same offset looked correct.
 */
export function scrollbarWidthOf(box: { offsetWidth: number; clientWidth: number } | undefined): number {
  if (box === undefined) return 0;
  return Math.max(0, box.offsetWidth - box.clientWidth);
}
