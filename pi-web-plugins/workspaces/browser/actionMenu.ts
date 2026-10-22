const ACTION_MENU_GAP_PX = 0;
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

interface FixedBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
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

  return [
    ...placement,
    `right: ${px(Math.max(0, boxWidth - triggerRight))};`,
    `max-width: ${px(Math.max(0, triggerRight - leftBound))};`,
  ].join(" ");
}

function actionMenuBounds(target: HTMLElement, box: FixedBox): ActionMenuRect {
  const root = target.getRootNode();
  if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot && root.host instanceof HTMLElement) return root.host.getBoundingClientRect();
  return { top: box.top, right: box.left + box.width, bottom: box.top + box.height, left: box.left };
}

/**
 * Where a fixed panel rendered beside `near` is placed: the host may contain its layout, so the
 * panel lands in a box narrower than the browser's layout viewport (the host's own copy of this
 * measurement is src/client/src/fixedContainingBox.ts). Without layout it is the window.
 */
function fixedContainingBox(near: unknown): FixedBox {
  const windowBox: FixedBox = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  if (typeof document === "undefined" || typeof Node === "undefined" || !(near instanceof Node)) return windowBox;
  const root = near.getRootNode();
  const parent = typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? root : document.body;
  const probe = document.createElement("div");
  probe.style.cssText = "all: initial; position: fixed; inset: 0; visibility: hidden; pointer-events: none;";
  parent.append(probe);
  try {
    const rect = probe.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : windowBox;
  } finally {
    probe.remove();
  }
}

function boxBounds(box: FixedBox): ActionMenuRect {
  return { top: 0, right: box.width, bottom: box.height, left: 0 };
}

function withinBox(rect: ActionMenuRect, box: FixedBox): ActionMenuRect {
  return { top: rect.top - box.top, right: rect.right - box.left, bottom: rect.bottom - box.top, left: rect.left - box.left };
}

function px(value: number): string {
  return `${String(Math.round(value))}px`;
}
