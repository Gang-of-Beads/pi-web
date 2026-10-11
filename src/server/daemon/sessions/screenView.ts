/**
 * A drawn extension screen as the browser shows it (owner, 2026-10-11: draw a terminal-only
 * screen nicer and more like the web, without guessing).
 *
 * The component gets pi's own Theme with every color role a distinct truecolor value. What it
 * colors keeps its role through pi-tui's width arithmetic, since escape codes take no width, and
 * each drawn line is read back into runs that name those roles; the browser styles the roles with
 * its own colors. The plain theme the screen had before dropped them, so the reader lost what the
 * extension marked: the selected row, the dim notes, the accent title. Box drawing at a line's
 * edges is left out, and a line of nothing but box drawing is marked as frame.
 *
 * The cursor is read from what the extension marked rather than from glyphs alone: a run on the
 * selected background, else a line opening with a cursor glyph the extension colored, else the
 * first line opening with a cursor glyph. A tap walks the component's cursor to the tapped line one
 * key at a time and judges every step on the redraw it caused, so an item drawn on two lines, or a
 * list that scrolls, still lands where the reader tapped. Counting lines read pi-prompt-history's
 * query line ("> ") as its cursor and its two-line results as twice as many items.
 */
import { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  EXTENSION_DIALOG_SCREEN_MAX_LINES,
  EXTENSION_DIALOG_SCREEN_MAX_SPANS,
  type ScreenLine,
  type ScreenSpan,
} from "../../../shared/apiTypes.js";
import { SUPERCLASS_BACKGROUND_COLORS, SUPERCLASS_FOREGROUND_COLORS } from "./plainTextTheme.js";

const FOREGROUND_ROLES: readonly string[] = [...Object.keys(SUPERCLASS_FOREGROUND_COLORS), "scrollbarTrack", "scrollbarThumb", "searchMatchText"];
const BACKGROUND_ROLES: readonly string[] = [...Object.keys(SUPERCLASS_BACKGROUND_COLORS), "searchMatchBg"];

/** The red channel names the plane, green the role's place in its list, blue marks the value as a role. */
const ROLE_MARK = { foreground: 16, background: 32, blue: 254 } as const;

const ESCAPE = "\u001b";
const BELL = "\u0007";
const STRING_TERMINATOR = "\u001b\\";

function roleCode(plane: 38 | 48, mark: number, index: number): string {
  return `${ESCAPE}[${String(plane)};2;${String(mark)};${String(index)};${String(ROLE_MARK.blue)}m`;
}

function preserveText(text: string): string {
  return text;
}

class ScreenTheme extends Theme {
  constructor() {
    super(SUPERCLASS_FOREGROUND_COLORS, SUPERCLASS_BACKGROUND_COLORS, "truecolor", { name: "pi-web-screen" });
  }

  override fg(color: Parameters<Theme["fg"]>[0], text: string): string {
    return `${this.getFgAnsi(color)}${text}${ESCAPE}[39m`;
  }

  override bg(color: Parameters<Theme["bg"]>[0], text: string): string {
    return `${this.getBgAnsi(color)}${text}${ESCAPE}[49m`;
  }

  override bold(text: string): string {
    return `${ESCAPE}[1m${text}${ESCAPE}[22m`;
  }

  override italic(text: string): string {
    return `${ESCAPE}[3m${text}${ESCAPE}[23m`;
  }

  override underline(text: string): string {
    return `${ESCAPE}[4m${text}${ESCAPE}[24m`;
  }

  override inverse(text: string): string {
    return `${ESCAPE}[7m${text}${ESCAPE}[27m`;
  }

  override strikethrough(text: string): string {
    return `${ESCAPE}[9m${text}${ESCAPE}[29m`;
  }

  override getFgAnsi(color: Parameters<Theme["getFgAnsi"]>[0]): string {
    const index = FOREGROUND_ROLES.indexOf(color);
    return index < 0 ? "" : roleCode(38, ROLE_MARK.foreground, index);
  }

  override getBgAnsi(color: Parameters<Theme["getBgAnsi"]>[0]): string {
    const index = BACKGROUND_ROLES.indexOf(color);
    return index < 0 ? "" : roleCode(48, ROLE_MARK.background, index);
  }

  override getColorMode(): ReturnType<Theme["getColorMode"]> {
    return "truecolor";
  }

  override getThinkingBorderColor(
    level: Parameters<Theme["getThinkingBorderColor"]>[0],
  ): ReturnType<Theme["getThinkingBorderColor"]> {
    void level;
    return preserveText;
  }

  override getBashModeBorderColor(): ReturnType<Theme["getBashModeBorderColor"]> {
    return preserveText;
  }
}

/** The theme a drawn screen's component gets: pi's roles, each readable back from the drawn line. */
export const screenTheme: Theme = new ScreenTheme();

interface Pen {
  fg: string | undefined;
  bg: string | undefined;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strike: boolean;
}

const PLAIN_PEN: Pen = { fg: undefined, bg: undefined, bold: false, dim: false, italic: false, underline: false, inverse: false, strike: false };

const SGR_EFFECTS: Readonly<Record<number, Partial<Pen>>> = {
  0: PLAIN_PEN,
  1: { bold: true },
  2: { dim: true },
  3: { italic: true },
  4: { underline: true },
  7: { inverse: true },
  9: { strike: true },
  22: { bold: false, dim: false },
  23: { italic: false },
  24: { underline: false },
  27: { inverse: false },
  29: { strike: false },
  39: { fg: undefined },
  49: { bg: undefined },
};

/** A basic color code (30-37, 90-97 and their backgrounds) names no role. */
function basicColorEffect(code: number): Partial<Pen> {
  if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) return { fg: undefined };
  if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) return { bg: undefined };
  return {};
}

/** The role an extended color names, and how many parameters it took after its 38 or 48. */
function extendedColor(codes: readonly number[], at: number, roles: readonly string[], mark: number): { role: string | undefined; length: number } {
  const mode = codes[at];
  if (mode === 5) return { role: undefined, length: 2 };
  if (mode !== 2) return { role: undefined, length: 0 };
  const isRole = codes[at + 1] === mark && codes[at + 3] === ROLE_MARK.blue;
  return { role: isRole ? roles[codes[at + 2] ?? -1] : undefined, length: 4 };
}

function applySgr(pen: Pen, codes: readonly number[]): Pen {
  let next = pen;
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? 0;
    if (code === 38) {
      const color = extendedColor(codes, index + 1, FOREGROUND_ROLES, ROLE_MARK.foreground);
      next = { ...next, fg: color.role };
      index += color.length;
    } else if (code === 48) {
      const color = extendedColor(codes, index + 1, BACKGROUND_ROLES, ROLE_MARK.background);
      next = { ...next, bg: color.role };
      index += color.length;
    } else {
      next = { ...next, ...(SGR_EFFECTS[code] ?? basicColorEffect(code)) };
    }
  }
  return next;
}

/** Where an escape sequence starting at `at` ends, and its SGR parameters when it sets a style. */
function escapeAt(line: string, at: number): { end: number; sgr?: number[] } {
  const kind = line.charAt(at + 1);
  if (kind === "[") {
    let index = at + 2;
    while (index < line.length && line.charCodeAt(index) >= 0x30 && line.charCodeAt(index) <= 0x3f) index += 1;
    const parameters = line.slice(at + 2, index);
    while (index < line.length && line.charCodeAt(index) >= 0x20 && line.charCodeAt(index) <= 0x2f) index += 1;
    const final = line.charAt(index);
    const end = Math.min(line.length, index + 1);
    if (final !== "m") return { end };
    return { end, sgr: parameters === "" ? [0] : parameters.split(";").map((part) => Number.parseInt(part, 10) || 0) };
  }
  if (kind === "]" || kind === "_" || kind === "P") {
    const bell = line.indexOf(BELL, at + 2);
    const terminator = line.indexOf(STRING_TERMINATOR, at + 2);
    const ends = [bell < 0 ? undefined : bell + 1, terminator < 0 ? undefined : terminator + STRING_TERMINATOR.length].filter((end) => end !== undefined);
    return { end: ends.length === 0 ? line.length : Math.min(...ends) };
  }
  return { end: Math.min(line.length, at + 2) };
}

function samePen(left: Pen, right: Pen): boolean {
  return left.fg === right.fg && left.bg === right.bg && left.bold === right.bold && left.dim === right.dim
    && left.italic === right.italic && left.underline === right.underline && left.inverse === right.inverse && left.strike === right.strike;
}

function spanOf(text: string, pen: Pen): ScreenSpan {
  return {
    text,
    ...(pen.fg === undefined ? {} : { fg: pen.fg }),
    ...(pen.bg === undefined ? {} : { bg: pen.bg }),
    ...(pen.bold ? { bold: true as const } : {}),
    ...(pen.dim ? { dim: true as const } : {}),
    ...(pen.italic ? { italic: true as const } : {}),
    ...(pen.underline ? { underline: true as const } : {}),
    ...(pen.inverse ? { inverse: true as const } : {}),
    ...(pen.strike ? { strike: true as const } : {}),
  };
}

const BOX_DRAWING = /[\u2500-\u257f]/u;
const ONLY_BOX_DRAWING = /^[\s\u2500-\u257f]*$/u;
const BOX_EDGE_START = /^[\u2500-\u257f]+/u;
const BOX_EDGE_END = /[\s\u2500-\u257f]+$/u;
const BOX_ONLY_END = /[\u2500-\u257f]+$/u;

/**
 * The runs without the box drawing at the line's edges, nor the padding before the right edge; a
 * run left empty goes. A painted run (inverse, or on a background) is visible even when it is
 * blank, an input's cursor block among them, so only box drawing comes off it.
 */
function withoutEdges(spans: readonly ScreenSpan[]): ScreenSpan[] {
  const out = [...spans];
  for (let first = out[0]; first !== undefined; first = out[0]) {
    const text = first.text.replace(BOX_EDGE_START, "");
    if (text === first.text) break;
    if (text !== "") {
      out[0] = { ...first, text };
      break;
    }
    out.shift();
  }
  for (let last = out[out.length - 1]; last !== undefined; last = out[out.length - 1]) {
    const painted = last.inverse === true || last.bg !== undefined;
    const text = last.text.replace(painted ? BOX_ONLY_END : BOX_EDGE_END, "");
    if (text === last.text) break;
    if (text !== "") {
      out[out.length - 1] = { ...last, text };
      break;
    }
    out.pop();
  }
  return out;
}

/** One drawn line read back into runs by the roles and emphasis it was drawn with. */
export function screenLine(drawn: string): ScreenLine {
  const spans: ScreenSpan[] = [];
  let pen = PLAIN_PEN;
  let text = "";
  for (let at = 0; at < drawn.length;) {
    const character = drawn.charAt(at);
    if (character !== ESCAPE) {
      text += character;
      at += 1;
      continue;
    }
    const escape = escapeAt(drawn, at);
    if (escape.sgr !== undefined) {
      const next = applySgr(pen, escape.sgr);
      if (!samePen(pen, next)) {
        if (text !== "") spans.push(spanOf(text, pen));
        text = "";
        pen = next;
      }
    }
    at = Math.max(at + 1, escape.end);
  }
  if (text !== "") spans.push(spanOf(text, pen));
  const whole = spans.map((span) => span.text).join("");
  if (BOX_DRAWING.test(whole) && ONLY_BOX_DRAWING.test(whole)) return { spans: [], frame: true };
  return { spans: withoutEdges(spans).slice(0, EXTENSION_DIALOG_SCREEN_MAX_SPANS) };
}

const CURSOR_GLYPH_LIST = ["›", ">", "▸", "▪", "▶", "➤", "❯", "→", "●", "•", "*"] as const;
const CURSOR_CLASS = CURSOR_GLYPH_LIST.join("");
const CURSOR_GLYPHS: ReadonlySet<string> = new Set<string>(CURSOR_GLYPH_LIST);
const QUIET_ROLES: ReadonlySet<string> = new Set(["text", "dim", "muted", "border", "borderMuted"]);
const DRAWN_CURSOR = new RegExp(`^[\\s│┃|]*[${CURSOR_CLASS}]\\s`, "u");

function opensWithMarkedCursor(spans: readonly ScreenSpan[]): boolean {
  const first = spans.find((span) => span.text.trim() !== "");
  if (first === undefined || !CURSOR_GLYPHS.has(first.text.trimStart().charAt(0))) return false;
  return first.inverse === true || (first.fg !== undefined && !QUIET_ROLES.has(first.fg));
}

/** The line the component's cursor is on: on the selected background, else a colored cursor glyph, else a drawn one. */
export function selectedScreenLine(styled: readonly ScreenLine[], plain: readonly string[]): number | undefined {
  const rules = [
    () => styled.findIndex((line) => line.spans.some((span) => span.bg === "selectedBg")),
    () => styled.findIndex((line) => opensWithMarkedCursor(line.spans)),
    () => plain.findIndex((line) => DRAWN_CURSOR.test(line)),
  ];
  for (const rule of rules) {
    const found = rule();
    if (found >= 0) return found;
  }
  return undefined;
}

/** A drawn screen three ways: plain text, styled runs and where its cursor is. */
export interface ScreenView {
  lines: string[];
  styled: ScreenLine[];
  selected: number | undefined;
}

/** The view of what a component drew, bounded to the lines a dialog keeps. */
export function screenView(drawn: readonly string[]): ScreenView {
  const bounded = drawn.slice(0, EXTENSION_DIALOG_SCREEN_MAX_LINES);
  const lines = bounded.map((line) => stripTerminalSequences(line));
  const styled = bounded.map((line) => screenLine(line));
  return { lines, styled, selected: selectedScreenLine(styled, lines) };
}

/** A screen a tap drives: press a named key, then read it again. */
export interface DrivenScreen {
  press(key: string): void;
  view(): ScreenView;
}

type Direction = "down" | "up";

const OPPOSITE: Record<Direction, Direction> = { down: "up", up: "down" };

/**
 * What one keypress did to the cursor: moved it on (the list may have scrolled under it instead),
 * left it where it was (the end of a list that stops), or sent it round to the other end (a list
 * that wraps, as pi-tui's do).
 */
export type Motion = "moved" | "stuck" | "wrapped";

export function motionOf(direction: Direction, from: number, to: number | undefined, redrawn: boolean): Motion {
  if (to === undefined) return "moved";
  if (to === from) return redrawn ? "moved" : "stuck";
  const wentBack = direction === "down" ? to < from : to > from;
  return wentBack ? "wrapped" : "moved";
}

/**
 * What one step of a tap's walk found, read from the redraw after the cursor moved toward the
 * tapped line: it is there (select it), still short of it (step again), past it going down (the
 * tapped line belonged to the item before: step back, then select), past it going up (it belongs
 * to the item now under the cursor: select it), past the end of the list with the tapped line
 * still below (it may be the last item's own second line), or nowhere to go (stop).
 */
export type WalkStep = "select" | "step" | "back-then-select" | "past-the-end" | "stop";

export function walkStep(direction: Direction, motion: Motion, from: number, selected: number | undefined, target: number | undefined): WalkStep {
  if (selected === undefined || target === undefined) return "stop";
  if (motion !== "moved") return direction === "down" && target > from ? "past-the-end" : "stop";
  if (selected === target) return "select";
  const passed = direction === "down" ? selected > target : selected < target;
  if (!passed) return "step";
  return direction === "down" ? "back-then-select" : "select";
}

const LINE_EDGES = /^[\s\u2500-\u257f]+|[\s\u2500-\u257f]+$/gu;
const LEADING_CURSOR = new RegExp(`^[${CURSOR_CLASS}]\\s*`, "u");

/** A line as itself across redraws: without its frame, and without the cursor that moves onto it. */
function lineKey(line: string): string {
  return line.replace(LINE_EDGES, "").replace(LEADING_CURSOR, "");
}

/** The line drawn as `key` nearest to where it was: a list may scroll as the cursor moves. */
function locateLine(lines: readonly string[], key: string, near: number): number | undefined {
  if (lines[near] !== undefined && lineKey(lines[near]) === key) return near;
  let found: number | undefined;
  lines.forEach((line, index) => {
    if (lineKey(line) === key && (found === undefined || Math.abs(index - near) < Math.abs(found - near))) found = index;
  });
  return found;
}

/** How many lines an item takes, from one step up and back: the distance the cursor moved. */
function probedItemHeight(screen: DrivenScreen, selected: number): number | undefined {
  screen.press("up");
  const above = screen.view().selected;
  screen.press("down");
  return above === undefined || above >= selected ? undefined : selected - above;
}

/**
 * Whether a line below the last item's cursor line is still part of that item: within one item's
 * height, as the walk's own steps measured it, or as one step up and back measures it. A line
 * further down (a footer, a key hint) selects nothing.
 */
function insideLastItem(screen: DrivenScreen, last: number, target: number, itemHeight: number | undefined): boolean {
  const height = itemHeight ?? probedItemHeight(screen, last);
  return height !== undefined && target - last < height;
}

/**
 * Move the component's cursor to the tapped line and select it. A tap on no item selects nothing
 * and walks the cursor back to where it was, so the screen is as the reader left it.
 */
export function walkScreenTo(screen: DrivenScreen, tapped: { line: number; text: string }): void {
  let view = screen.view();
  const key = lineKey(tapped.text);
  let target = locateLine(view.lines, key, tapped.line);
  const start = view.selected;
  if (target === undefined || start === undefined) return;
  if (start === target) {
    screen.press("enter");
    return;
  }
  const direction: Direction = target > start ? "down" : "up";
  let moves = 0;
  let itemHeight: number | undefined;
  const walkBack = (): void => {
    for (; moves > 0; moves -= 1) screen.press(OPPOSITE[direction]);
  };
  for (let step = 0; step < EXTENSION_DIALOG_SCREEN_MAX_LINES; step += 1) {
    const from = view.selected;
    const aimed = target;
    if (from === undefined || aimed === undefined) break;
    const before = view.lines.join("\n");
    screen.press(direction);
    view = screen.view();
    const motion = motionOf(direction, from, view.selected, before !== view.lines.join("\n"));
    if (motion !== "stuck") moves += 1;
    if (motion === "moved" && view.selected !== undefined && view.selected !== from) itemHeight = Math.abs(view.selected - from);
    target = locateLine(view.lines, key, aimed);
    const finish: Record<Exclude<WalkStep, "step">, () => void> = {
      select: () => { screen.press("enter"); },
      "back-then-select": () => {
        screen.press(OPPOSITE[direction]);
        screen.press("enter");
      },
      "past-the-end": () => {
        if (motion === "wrapped") {
          screen.press(OPPOSITE[direction]);
          moves -= 1;
        }
        if (insideLastItem(screen, from, aimed, itemHeight)) screen.press("enter");
        else walkBack();
      },
      stop: walkBack,
    };
    const next = walkStep(direction, motion, from, view.selected, motion === "moved" ? target : aimed);
    if (next === "step") continue;
    finish[next]();
    return;
  }
  walkBack();
}
