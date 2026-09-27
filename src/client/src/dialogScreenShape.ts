/**
 * Read an extension's screen as the shape it is, so it can be rendered natively.
 *
 * A TUI component draws with a frame, a cursor and no semantics: what the reader
 * sees is a terminal dump ("这是啥啊"). But the shapes are recognisable - a menu is a
 * cursor plus its siblings, a confirmation is a heading plus a body plus those
 * options - and once read, they render as the same native card the ask and confirm
 * flows use: real buttons, real text, no box-drawing characters.
 *
 * Deliberately conservative: a screen that does not parse stays text, which is
 * faithful, and the key row keeps it drivable.
 */
import { isScreenHintLine, screenCursorLine } from "./dialogScreenKeys.js";

export interface ScreenOption {
  label: string;
  /** Which line it came from, so a tap can walk the component's cursor to it. */
  line: number;
  /** The option the component's own cursor is on. */
  current: boolean;
}

export type ScreenShape =
  | { kind: "menu"; title: string | undefined; body: string[]; options: ScreenOption[] }
  | { kind: "text"; body: string[] };

const FRAME = /^[\s│┃|]*|[│┃| ]*$/gu;
const RULE = /^[\s─━┄┈=_│┃|├┤┬┴┼┌┐└┘]+$/u;

/** A line as content: the component's frame characters removed. */
export function stripFrame(line: string): string {
  return line.replace(FRAME, "").replace(/\s+$/u, "");
}

function isRule(line: string): boolean {
  const text = stripFrame(line);
  return text === "" ? false : RULE.test(text);
}

/**
 * The option block around the cursor: contiguous lines that are options.
 *
 * Bounded by blank lines, rules and the hint row, so a task list above a two-option
 * menu does not become sixteen options.
 */
function optionBlock(lines: readonly string[], cursor: number): number[] {
  // The cursor line may sit one step deeper than its siblings (a TUI often marks it
  // with an extra space); a block is therefore scanned by "is this row short and
  // sibling-like", not by matching the cursor's exact indentation.
  const isSibling = (line: string): boolean => {
    const content = stripFrame(line).trim();
    if (content === "") return false;
    if (isRule(line) || isScreenHintLine(line)) return false;
    // A line that labels the block ("Proposed task list:"), a checklist row or
    // anything long enough to be prose is body; options are short action labels.
    if (content.endsWith(":")) return false;
    if (/^\[[ xX*]\]/u.test(content)) return false;
    return content.length <= 48;
  };
  // Indentation is measured on the *content*, not the framed line: every line here
  // carries the component's own frame, and its inner padding would otherwise make
  // the cursor look more indented than its siblings and break the block apart.
  const indent = (line: string): number => stripFrame(line).length - stripFrame(line).trimStart().length;
  const baseline = indent(lines[cursor] ?? "");
  const block: number[] = [cursor];
  const walk = (direction: 1 | -1): void => {
    for (let index = cursor + direction; index >= 0 && index < lines.length; index += direction) {
      const line = lines[index] ?? "";
      if (!isSibling(line)) break;
      // Indentation is a hint, not a rule: a TUI may mark the cursor with an extra
      // space and its siblings with a hanging indent, so the block is bounded by
      // blank lines, rules and the hint row instead.
      if (indent(line) > baseline + 4) break;
      if (index < cursor - 6) break;
      block.push(index);
    }
  };
  walk(1);
  walk(-1);
  return block.sort((left, right) => left - right);
}

/** Read the screen: a menu when it has options, text otherwise. */
export function classifyScreen(lines: readonly string[]): ScreenShape {
  const text = lines.map(stripFrame);
  const cursor = screenCursorLine(lines);
  if (cursor === undefined) return { kind: "text", body: text };

  const block = optionBlock(lines, cursor);
  if (block.length < 2 || block.length > 12) return { kind: "text", body: text };

  const first = block[0] ?? 0;
  // A heading is a line before the options that is not itself body prose: the
  // component put it above the block on its own.
  // The screen's own heading is its first real line - a component draws one above
  // everything else; the body is what sits between it and the options.
  const headingIndex = text.slice(0, first).findIndex((line) => {
    const content = line.trim();
    if (content === "" || isRule(line)) return false;
    if (/^\[[ xX*]\]/u.test(content)) return false;
    if (/^[›>▸▪•*]\s/u.test(content)) return false;
    return content.length <= 48;
  });
  const title = headingIndex === -1 ? undefined : text[headingIndex]?.trim();
  const bodyStart = headingIndex === -1 ? 0 : headingIndex + 1;
  const body = text.slice(bodyStart, first).filter((line) => !isScreenHintLine(line) && !isRule(line));

  return {
    kind: "menu",
    title,
    body: trimBlankEdges(body),
    options: block.map((line) => ({
      label: stripFrame(lines[line] ?? "").replace(/^[›>▸▪•*]\s*/u, "").trim(),
      line,
      current: line === cursor,
    })),
  };
}

function trimBlankEdges(lines: readonly string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && (out[0] ?? "").trim() === "") out.shift();
  while (out.length > 0 && (out[out.length - 1] ?? "").trim() === "") out.pop();
  return out;
}

/** The shape an extension declared for its own screen, when it declared one. */
export function shapeFromScreen(
  screen: {
  kind: "menu" | "text";
  title?: string | undefined;
  body?: string[] | undefined;
  options?: string[] | undefined;
    current?: number | undefined;
  },
  /**
   * The component's own redraw, when it is known: the declaration says what the
   * screen *is*, the lines say where its cursor currently is, so a keystroke moves
   * the highlight without the extension redeclaring anything.
   */
  lines: readonly string[] = [],
): ScreenShape {
  if (screen.kind === "text" || screen.options === undefined) {
    return { kind: "text", body: [...(screen.body ?? []), ...(screen.options ?? [])] };
  }
  const cursorLine = screenCursorLine(lines);
  return {
    kind: "menu",
    title: screen.title,
    body: screen.body ?? [],
    options: screen.options.map((label, index) => {
      const line = lineForOption(lines, label, index);
      const drawn = stripFrame(lines[line] ?? "");
      const current =
        cursorLine === undefined ? index === screen.current : line === cursorLine && drawn.includes(label.trim());
      return { label, line, current };
    }),
  };
}

/**
 * Which drawn line an option came from, so a tap can walk the component's cursor.
 *
 * A declared option is a label the extension also drew, so the match is by content;
 * when it cannot be found the cursor line stands in, and the tap is simply "enter".
 */
export function lineForOption(lines: readonly string[], label: string, fallback: number): number {
  const wanted = label.trim();
  if (wanted !== "") {
    const found = lines.findIndex((line) => stripFrame(line).includes(wanted));
    if (found !== -1) return found;
  }
  return Math.min(Math.max(fallback, 0), Math.max(lines.length - 1, 0));
}
