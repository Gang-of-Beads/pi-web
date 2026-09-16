/**
 * A transcript selection becomes a quoted prompt: every line prefixed, then
 * one empty line, so the composer opens with a citation the agent reads as
 * quotation.
 */

export function quotedPrompt(selection: string): string {
  const lines = selection.replace(/\r\n?/gu, "\n").split("\n");
  while (lines.length > 0 && (lines.at(-1) ?? "").trim() === "") lines.pop();
  if (lines.length === 0) return "";
  return `${lines.map((line) => `> ${line}`).join("\n")}\n\n`;
}

