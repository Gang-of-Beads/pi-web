const ACTION_MENU_GAP_PX = 0;
/**
 * Narrowest the panel may be while still reading as a menu. The panel's own
 * stylesheet asks for 240px; right-aligning it to a trigger with less room
 * than that pushed the box off the left of the screen, where half the items
 * could not be read or tapped (reported on a two-column board at 393px).
 */
const ACTION_MENU_MIN_WIDTH_PX = 200;
const ACTION_MENU_MIN_USEFUL_HEIGHT_PX = 120;

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
  const trigger = target.getBoundingClientRect();
  const bounds = options.constrainTo === "viewport" ? viewportBounds() : actionMenuBounds(target);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const leftBound = Math.max(0, bounds.left);
  const rightBound = Math.min(viewportWidth, bounds.right);
  const topBound = Math.max(0, bounds.top);
  const bottomBound = Math.min(viewportHeight, bounds.bottom);
  const triggerRight = Math.min(trigger.right, rightBound);
  const availableBelow = bottomBound - trigger.bottom - ACTION_MENU_GAP_PX;
  const availableAbove = trigger.top - topBound - ACTION_MENU_GAP_PX;
  const placement = availableBelow < ACTION_MENU_MIN_USEFUL_HEIGHT_PX && availableAbove > availableBelow
    ? [`bottom: ${px(viewportHeight - trigger.top + ACTION_MENU_GAP_PX)};`, `max-height: ${px(Math.max(0, availableAbove))};`]
    : [`top: ${px(trigger.bottom + ACTION_MENU_GAP_PX)};`, `max-height: ${px(Math.max(0, availableBelow))};`];

  const alignedWidth = Math.max(0, triggerRight - leftBound);
  if (alignedWidth >= ACTION_MENU_MIN_WIDTH_PX) {
    return [
      ...placement,
      `right: ${px(Math.max(0, viewportWidth - triggerRight))};`,
      `max-width: ${px(alignedWidth)};`,
    ].join(" ");
  }
  // Too little room beside the trigger: sit inside the bounds instead of
  // hanging off them.
  return [
    ...placement,
    `left: ${px(leftBound)};`,
    `right: ${px(Math.max(0, viewportWidth - rightBound))};`,
    `max-width: ${px(Math.max(0, rightBound - leftBound))};`,
  ].join(" ");
}

function actionMenuBounds(target: HTMLElement): ActionMenuRect {
  const root = target.getRootNode();
  if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot && root.host instanceof HTMLElement) return root.host.getBoundingClientRect();
  return viewportBounds();
}

function viewportBounds(): ActionMenuRect {
  return { top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0 };
}

function px(value: number): string {
  return `${String(Math.round(value))}px`;
}
