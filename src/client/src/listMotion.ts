/**
 * Rows of a list slide to their new place when the server changes the list
 * (owner, 2026-10-06: the "quiet" setting of docs/design/cached-first-and-motion.md).
 *
 * The session list re-sorts as sessions start asking, finish or appear on
 * another device. Rows that jump without the reader doing anything are the
 * shift web.dev's layout-stability guidance counts against a page; a short
 * slide shows where a row went. The list is seen many times a day, so the
 * motion is short and plain - no scale, bounce or stagger - and it never plays
 * for what the reader did: a change the reader caused, a new scope, a search,
 * or the first rows a list draws apply at once, and so does everything under
 * `prefers-reduced-motion`.
 *
 * View transitions ignore names inside shadow roots (crbug 349653208), so this
 * is FLIP on the Web Animations API: each row is found by its
 * `data-motion-key`, measured before the render and after it, and played back
 * as a `transform` from the old box. Rows are matched by key rather than by
 * node, so a row that moved between sections, and was drawn as a new node,
 * still slides. Only rows within half a list-height of the visible part move;
 * the rest land in place.
 */
export const LIST_MOTION = {
  moveMs: 200,
  enterMs: 150,
  leaveMs: 120,
  /** Material 3 standard: the row starts at once and settles. */
  moveEasing: "cubic-bezier(0.2, 0, 0, 1)",
  /** Material 3 standard decelerate, for what arrives. */
  enterEasing: "cubic-bezier(0, 0, 0, 1)",
  /** Material 3 standard accelerate, for what leaves. */
  leaveEasing: "cubic-bezier(0.3, 0, 1, 1)",
} as const;

export const MOTION_KEY_ATTRIBUTE = "data-motion-key";

/** What one render does with a change to the rows: slide it, or apply it at once for the named reason. */
export type ListMotionGate = "play" | "first-paint" | "unchanged" | "scope-changed" | "reader-caused" | "reduced-motion" | "hidden";

/** What is known about one render of a list. */
export interface ListMotionFacts {
  /** The list drew rows before this render. */
  readonly hadRows: boolean;
  /** The rows it draws, or their order, differ from the last render. */
  readonly rowsChanged: boolean;
  /** The reader moved the list to another scope: another kind, search, project, fold, tile count or machine. */
  readonly scopeChanged: boolean;
  /** The reader pressed or typed a moment ago, or the host is still carrying out a change they asked for. */
  readonly readerActive: boolean;
  /** Asked only once every rule before it passed, so a render that applies at once reads no media query. */
  readonly reducedMotion: () => boolean;
  /** Asked last, so a render that applies at once reads no layout. */
  readonly shown: () => boolean;
}

/** The first rule that holds names why the change applies at once; when none holds, it plays. */
const GATE_RULES: readonly (readonly [ListMotionGate, (facts: ListMotionFacts) => boolean])[] = [
  ["first-paint", (facts) => !facts.hadRows],
  ["unchanged", (facts) => !facts.rowsChanged],
  ["scope-changed", (facts) => facts.scopeChanged],
  ["reader-caused", (facts) => facts.readerActive],
  ["reduced-motion", (facts) => facts.reducedMotion()],
  ["hidden", (facts) => !facts.shown()],
];

export function listMotionGate(facts: ListMotionFacts): ListMotionGate {
  return GATE_RULES.find(([, holds]) => holds(facts))?.[0] ?? "play";
}

export interface MotionBox {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** What each row does: slide from where it was, fade in, or leave a fading copy where it stood. */
export interface MotionPlan {
  readonly moves: readonly { readonly key: string; readonly dx: number; readonly dy: number }[];
  readonly enters: readonly string[];
  readonly leaves: readonly { readonly key: string; readonly box: MotionBox }[];
}

/** Less than this is a row that stayed: a subpixel slide is noise. */
const MIN_SHIFT_PX = 0.5;

/** The plan, given where each row was, where it is, and the band of the list worth animating. */
export function planListMotion(before: ReadonlyMap<string, MotionBox>, after: ReadonlyMap<string, MotionBox>, band: { readonly top: number; readonly bottom: number }): MotionPlan {
  const inBand = (box: MotionBox) => box.top + box.height > band.top && box.top < band.bottom;
  const arrived = [...after].filter(([key]) => !before.has(key));
  const stayed = [...after].flatMap(([key, box]) => {
    const was = before.get(key);
    return was === undefined ? [] : [{ key, was, box, dx: was.left - box.left, dy: was.top - box.top }];
  });
  return {
    moves: stayed
      .filter((row) => (Math.abs(row.dx) >= MIN_SHIFT_PX || Math.abs(row.dy) >= MIN_SHIFT_PX) && (inBand(row.was) || inBand(row.box)))
      .map(({ key, dx, dy }) => ({ key, dx, dy })),
    enters: arrived.filter(([, box]) => inBand(box)).map(([key]) => key),
    leaves: [...before].filter(([key, box]) => !after.has(key) && inBand(box)).map(([key, box]) => ({ key, box })),
  };
}

/** Who else shaped this render, as the list's host knows it. */
export interface ListChangeContext {
  readonly scopeChanged: boolean;
  readonly readerActive: boolean;
}

interface MeasuredRow {
  readonly box: MotionBox;
  readonly element: HTMLElement;
}

/**
 * One list's motion: `prepare` before each render with the row keys it will
 * draw, `play` after it. The list's container must be the rows' positioning
 * parent (`position: relative`), so a leaving row's fading copy sits where it was.
 */
export class ListMotion {
  private rowKeys: readonly string[] = [];
  private measured: Map<string, MeasuredRow> | undefined;
  private readonly running = new WeakMap<Element, Animation>();

  constructor(private readonly reducedMotion: () => boolean = prefersReducedMotion) {}

  prepare(container: HTMLElement | null, rowKeys: readonly string[], context: ListChangeContext): ListMotionGate {
    const previous = this.rowKeys;
    this.rowKeys = rowKeys;
    this.measured = undefined;
    const gate = listMotionGate({
      hadRows: previous.length > 0,
      rowsChanged: !sameKeys(previous, rowKeys),
      scopeChanged: context.scopeChanged,
      readerActive: context.readerActive,
      reducedMotion: this.reducedMotion,
      shown: () => container !== null && container.getClientRects().length > 0,
    });
    if (gate === "play" && container !== null) this.measured = measureRows(container);
    return gate;
  }

  play(container: HTMLElement | null): void {
    const measured = this.measured;
    this.measured = undefined;
    if (measured === undefined || container === null) return;
    const rows = keyedRows(container);
    for (const element of rows.values()) this.running.get(element)?.cancel();
    const after = new Map([...rows].map(([key, element]) => [key, boxOf(element)]));
    const before = new Map([...measured].map(([key, row]) => [key, row.box]));
    const frame = container.getBoundingClientRect();
    const plan = planListMotion(before, after, { top: frame.top - frame.height / 2, bottom: frame.bottom + frame.height / 2 });
    for (const move of plan.moves) {
      const element = rows.get(move.key);
      if (element !== undefined) this.running.set(element, element.animate([{ transform: `translate(${String(move.dx)}px, ${String(move.dy)}px)` }, { transform: "none" }], { duration: LIST_MOTION.moveMs, easing: LIST_MOTION.moveEasing }));
    }
    for (const key of plan.enters) {
      const element = rows.get(key);
      if (element !== undefined) this.running.set(element, element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: LIST_MOTION.enterMs, easing: LIST_MOTION.enterEasing }));
    }
    for (const leave of plan.leaves) {
      const source = measured.get(leave.key);
      if (source !== undefined) fadeOutCopy(container, source.element, leave.box);
    }
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && "matchMedia" in window && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function keyedRows(container: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  for (const element of container.querySelectorAll<HTMLElement>(`[${MOTION_KEY_ATTRIBUTE}]`)) {
    const key = element.getAttribute(MOTION_KEY_ATTRIBUTE);
    if (key !== null && !rows.has(key)) rows.set(key, element);
  }
  return rows;
}

function measureRows(container: HTMLElement): Map<string, MeasuredRow> {
  return new Map([...keyedRows(container)].map(([key, element]) => [key, { box: boxOf(element), element }]));
}

function boxOf(element: Element): MotionBox {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/**
 * The row is already gone from the list; a copy of it, outside the list's
 * rendering and unreachable by pointer or reader, fades where it stood while
 * the rows below close the gap.
 */
function fadeOutCopy(container: HTMLElement, element: HTMLElement, box: MotionBox): void {
  const copy = element.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return;
  copy.removeAttribute(MOTION_KEY_ATTRIBUTE);
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  const frame = container.getBoundingClientRect();
  Object.assign(copy.style, {
    position: "absolute",
    top: `${String(box.top - frame.top - container.clientTop + container.scrollTop)}px`,
    left: `${String(box.left - frame.left - container.clientLeft + container.scrollLeft)}px`,
    width: `${String(box.width)}px`,
    height: `${String(box.height)}px`,
    margin: "0",
    pointerEvents: "none",
  });
  container.append(copy);
  const fade = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LIST_MOTION.leaveMs, easing: LIST_MOTION.leaveEasing, fill: "forwards" });
  const remove = () => { copy.remove(); };
  fade.addEventListener("finish", remove, { once: true });
  fade.addEventListener("cancel", remove, { once: true });
}
