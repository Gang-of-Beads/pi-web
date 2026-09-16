/**
 * Pure helpers for the viewer's line-range mention: a selection in the raw
 * view becomes `@path:start-end`, the format the @-completion already
 * understands.
 */

export function mentionRef(path: string, fromLine: number, toLine: number): string {
  const start = Math.min(fromLine, toLine);
  const end = Math.max(fromLine, toLine);
  const range = start === end ? String(start) : `${String(start)}-${String(end)}`;
  // The @ trigger is whitespace-delimited, so a path with a space quotes like
  // the composer's own fileCompletionInsertText does.
  const head = path.includes(" ") ? `@"${path}"` : `@${path}`;
  return `${head}:${range}`;
}

