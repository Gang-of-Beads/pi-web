/**
 * Where a tool call's target text belongs in the card.
 *
 * A single line sits beside the tool name, which reads as one sentence. A
 * multi-line command cannot: every line after the first starts at the inline
 * box's left edge, under the tool name, so the card looks like it is indented
 * around an empty column. Multi-line targets get their own row at the card's
 * own edge, starting on the line below.
 */

export type ToolTargetPlacement = "inline" | "block";

export function toolTargetPlacement(text: string | undefined): ToolTargetPlacement {
  if (text === undefined) return "inline";
  return text.trimEnd().includes("\n") ? "block" : "inline";
}
