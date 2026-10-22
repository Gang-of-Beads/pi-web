import { fixedContainingBox, type FixedBox } from "../fixedContainingBox";

const ACTION_MENU_GAP_PX = 0;
/**
 * Narrowest the panel may be while still reading as a menu. The panel's own
 * stylesheet asks for 240px; right-aligning it to a trigger with less room
 * than that pushed the box off the left of the screen, where half the items
 * could not be read or tapped (reported on a two-column board at 393px).
 */
const ACTION_MENU_MIN_WIDTH_PX = 200;
/** Breathing room kept from the edges when the panel cannot hug its trigger. */
const ACTION_MENU_EDGE_INSET_PX = 8;
const ACTION_MENU_MIN_USEFUL_HEIGHT_PX = 120;
/** The panel's own min-width (`.action-menu-panel` in shared.ts): the room a pointer-placed menu keeps to its right. */
const ACTION_MENU_POINTER_WIDTH_PX = 240;

interface ActionMenuRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface ActionMenuPanelStyleOptions {
  constrainTo?: "host" | "viewport";
}

export function actionMenuPanelStyle(target: EventTarget | null, options: ActionMenuPanelStyleOptions = {}): string {
  if (typeof HTMLElement === "undefined" || typeof window === "undefined" || !(target instanceof HTMLElement)) return "";
  const box = fixedContainingBox(target);
  const trigger = withinBox(target.getBoundingClientRect(), box);
  const bounds = options.constrainTo === "viewport" ? boxBounds(box) : withinBox(actionMenuBounds(target, box), box);
  const boxWidth = box.width;
  const boxHeight = box.height;
  const leftBound = Math.max(0, bounds.left);
  const rightBound = Math.min(boxWidth, bounds.right);
  const topBound = Math.max(0, bounds.top);
  const bottomBound = Math.min(boxHeight, bounds.bottom);
  const triggerRight = Math.min(trigger.right, rightBound);
  const availableBelow = bottomBound - trigger.bottom - ACTION_MENU_GAP_PX;
  const availableAbove = trigger.top - topBound - ACTION_MENU_GAP_PX;
  const placement = availableBelow < ACTION_MENU_MIN_USEFUL_HEIGHT_PX && availableAbove > availableBelow
    ? [`bottom: ${px(boxHeight - trigger.top + ACTION_MENU_GAP_PX)};`, `max-height: ${px(Math.max(0, availableAbove))};`]
    : [`top: ${px(trigger.bottom + ACTION_MENU_GAP_PX)};`, `max-height: ${px(Math.max(0, availableBelow))};`];

  const alignedWidth = Math.max(0, triggerRight - leftBound);
  if (alignedWidth >= ACTION_MENU_MIN_WIDTH_PX) {
    return [
      ...placement,
      `right: ${px(Math.max(0, boxWidth - triggerRight))};`,
      `max-width: ${px(alignedWidth)};`,
      `--action-menu-room: ${px(alignedWidth)};`,
    ].join(" ");
  }
  // Too little room to the trigger's left: keep the panel its own width and
  // slide it along the bounds instead of stretching it across them. A menu
  // that spans the screen reads as a sheet, not as this row's actions.
  const inner = Math.max(0, rightBound - leftBound - 2 * ACTION_MENU_EDGE_INSET_PX);
  const width = Math.min(ACTION_MENU_MIN_WIDTH_PX, inner);
  const preferred = trigger.left - width;
  const left = Math.min(
    Math.max(preferred, leftBound + ACTION_MENU_EDGE_INSET_PX),
    Math.max(leftBound + ACTION_MENU_EDGE_INSET_PX, rightBound - ACTION_MENU_EDGE_INSET_PX - width),
  );
  return [
    ...placement,
    `left: ${px(left)};`,
    "right: auto;",
    `width: ${px(width)};`,
    `max-width: ${px(inner)};`,
  ].join(" ");
}

/**
 * A row's menu opened by a right-click stands where the pointer is, as the platform's own context
 * menu does (owner, 2026-10-09: "right-click should give the ⋯ menu's options, natively"): its top
 * left corner at the pointer, slid left or lifted above the pointer when its containing box has no
 * room for it there.
 */
export function actionMenuPanelStyleAtPointer(event: MouseEvent): string {
  if (typeof window === "undefined") return "";
  const box = fixedContainingBox(event.target);
  const bounds = boxBounds(box);
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  const left = Math.max(ACTION_MENU_EDGE_INSET_PX, Math.min(x, bounds.right - ACTION_MENU_EDGE_INSET_PX - ACTION_MENU_POINTER_WIDTH_PX));
  const below = bounds.bottom - y - ACTION_MENU_EDGE_INSET_PX;
  const above = y - ACTION_MENU_EDGE_INSET_PX;
  const vertical = below < ACTION_MENU_MIN_USEFUL_HEIGHT_PX && above > below
    ? [`bottom: ${px(bounds.bottom - y)};`, `max-height: ${px(above)};`]
    : [`top: ${px(y)};`, `max-height: ${px(below)};`];
  return [...vertical, `left: ${px(left)};`, "right: auto;", `max-width: ${px(bounds.right - ACTION_MENU_EDGE_INSET_PX - left)};`].join(" ");
}

/**
 * Whether a context-menu request came from a mouse. Android fires the same event for a touch
 * long press, which belongs to the list's own long-press handling.
 */
export function contextMenuFromMouse(event: MouseEvent): boolean {
  return !(event instanceof PointerEvent) || event.pointerType === "mouse" || event.pointerType === "";
}

function actionMenuBounds(target: HTMLElement, box: FixedBox): ActionMenuRect {
  const root = target.getRootNode();
  if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot && root.host instanceof HTMLElement) return root.host.getBoundingClientRect();
  return { top: box.top, right: box.left + box.width, bottom: box.top + box.height, left: box.left };
}

/** The whole box a fixed panel is placed in, in that box's own coordinates. */
function boxBounds(box: FixedBox): ActionMenuRect {
  return { top: 0, right: box.width, bottom: box.height, left: 0 };
}

/** A client rectangle in the coordinates a fixed panel in `box` is placed with. */
function withinBox(rect: ActionMenuRect, box: FixedBox): ActionMenuRect {
  return { top: rect.top - box.top, right: rect.right - box.left, bottom: rect.bottom - box.top, left: rect.left - box.left };
}

function px(value: number): string {
  return `${String(Math.round(value))}px`;
}
