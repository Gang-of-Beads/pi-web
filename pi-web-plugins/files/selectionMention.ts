/**
 * Pure helpers for the viewer's line-range mention: a selection in the raw
 * view becomes `@path:start-end`, the format the @-completion already
 * understands.
 */

export function mentionRef(path: string, fromLine: number, toLine: number): string {
  const start = Math.min(fromLine, toLine);
  const end = Math.max(fromLine, toLine);
  const range = start === end ? String(start) : `${String(start)}-${String(end)}`;
  return `@${path}:${range}`;
}

export function mentionLineRange(docText: string, fromOffset: number, toOffset: number): { start: number; end: number } | undefined {
  if (fromOffset === toOffset) return undefined;
  const lo = Math.min(fromOffset, toOffset);
  const hi = Math.max(fromOffset, toOffset);
  const countLines = (offset: number): number => {
    let line = 1;
    for (let i = 0; i < offset && i < docText.length; i += 1) {
      if (docText[i] === "\n") line += 1;
    }
    return line;
  };
  return { start: countLines(lo), end: countLines(hi) };
}
