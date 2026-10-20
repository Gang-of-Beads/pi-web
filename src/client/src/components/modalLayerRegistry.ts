interface RenderedModalLayer {
  /** Connected element whose composed subtree owns this modal's focus. */
  element: HTMLElement;
  /**
   * Where the paint-order walk starts (`compareStackingOrder`); the element itself when absent.
   * The walk reads every z-indexed ancestor from here up, so a host only names this to rank the
   * layer from an outer element instead.
   */
  paintElement?: HTMLElement;
  /**
   * Native modal dialogs render in the browser's top layer above custom
   * overlays and hold modality from `showModal()` until `close()`.
   */
  nativeTopLayer?: boolean;
  /** Apply this layer's viable focus target when it becomes visually topmost. */
  focus: () => void;
  /** Keep layer-specific accessibility state in sync with visual ownership. */
  onTopChange?: (isTop: boolean) => void;
}

export interface RenderedModalRegistration {
  readonly isTop: boolean;
  focus: () => boolean;
  unregister: () => void;
}

interface RegisteredModalLayer {
  layer: RenderedModalLayer;
  order: number;
  restorationPath: HTMLElement[];
}

const registeredModalLayers = new Set<RegisteredModalLayer>();
const presenceListeners = new Set<() => void>();
let modalLayerOrder = 0;

/**
 * The attribute that keeps a background element live behind a modal: a status line that rides
 * above dialogs, or a polite announcer, has no control to reach and must still be heard, and the
 * composer stays usable under its history sheet, which opens above it and never covers it. A
 * marker counts only for a layer drawn inside the marker's own tree (its document or shadow root,
 * through any shadow roots under it): the app's row and announcers stay live behind every app
 * dialog, while the composer stays live behind its own history sheet but not behind Settings.
 */
const LIVE_BEHIND_MODAL_ATTRIBUTE = "data-live-behind-modal";

/** The elements this registry made inert, and only those: an author's own `inert` is never touched. */
const inertBehindModal = new Set<HTMLElement>();

/**
 * Register a rendered modal layer with the document-wide modality and focus
 * boundary. Registrations are owned by the component that renders the layer
 * and must be removed when that rendered layer closes or disconnects.
 */
export function registerRenderedModal(layer: RenderedModalLayer): RenderedModalRegistration {
  const ownerDocument = layer.element.ownerDocument;
  const previous = deepActiveElement(ownerDocument);
  const lowerLayer = previous instanceof HTMLElement ? containingModalLayer(ownerDocument, previous) : undefined;
  const registered: RegisteredModalLayer = {
    layer,
    order: ++modalLayerOrder,
    restorationPath: previous instanceof HTMLElement
      ? [previous, ...(lowerLayer?.restorationPath ?? [])]
      : [],
  };
  let active = true;

  registeredModalLayers.add(registered);
  notifyModalLayers(ownerDocument);
  const renderedChange = observeRenderedChange(layer.element, () => { notifyModalLayers(ownerDocument); });

  return {
    get isTop() {
      return active && topModalLayer(ownerDocument) === registered;
    },
    focus: () => active && focusModalLayer(registered),
    unregister: () => {
      if (!active) return;
      active = false;
      renderedChange?.disconnect();
      registeredModalLayers.delete(registered);
      notifyModalLayers(ownerDocument);
      restoreAfterModalClose(registered);
    },
  };
}

/** True only while a visibly rendered modal is registered in this document. */
export function hasRenderedModal(ownerDocument: Document | undefined): boolean {
  return ownerDocument !== undefined && topModalLayer(ownerDocument) !== undefined;
}

/** Background content cannot own live diagnostics while another modal owns the document. */
export function isForegroundModalContent(element: HTMLElement): boolean {
  const top = topModalLayer(element.ownerDocument);
  return top === undefined || composedContains(top.layer.element, element);
}

function restoreAfterModalClose(registered: RegisteredModalLayer): void {
  const { element } = registered.layer;
  const ownerDocument = element.ownerDocument;
  const active = deepActiveElement(ownerDocument);
  const focusWasReset = active === null || active === ownerDocument.body || active === ownerDocument.documentElement;
  // A newer or otherwise unrelated layer owns focus; closing this layer must
  // not pull focus away from it.
  if (!focusWasReset && !composedContains(element, active)) return;

  const lowerLayer = topModalLayer(ownerDocument);
  if (lowerLayer !== undefined) {
    const rememberedInsideLower = registered.restorationPath.filter((target) => composedContains(lowerLayer.layer.element, target));
    if (restoreFocus(rememberedInsideLower)) return;
    focusModalLayer(lowerLayer);
    return;
  }
  restoreFocus(registered.restorationPath);
}

function notifyModalLayers(ownerDocument: Document): void {
  const top = syncBackgroundInert(ownerDocument);
  for (const registered of [...registeredModalLayers]) {
    if (registered.layer.element.ownerDocument === ownerDocument) registered.layer.onTopChange?.(registered === top);
  }
  for (const listener of [...presenceListeners]) listener();
}

/**
 * Hear every registration and removal of a modal layer. The app row rides above whatever dialog
 * is open (owner, 2026-10-04), so the app has to know when one opens or closes; read
 * `hasRenderedModal` in the listener.
 */
export function onModalPresenceChange(listener: () => void): () => void {
  presenceListeners.add(listener);
  return () => { presenceListeners.delete(listener); };
}

/**
 * Everything outside the topmost modal is inert while it is open (owner review: the list behind a
 * modal stayed reachable by focus, by a screen reader, and by assistive clicks), and exactly the
 * marks this registry set come off when no modal is open. Only the top layer is live, so a dialog
 * over a sheet leaves the sheet inert. The marks go on the flat-tree siblings of each flat-tree
 * ancestor of the layer, never on an ancestor, because inertness follows the flat tree into shadow
 * roots and slots and an inert ancestor would take the modal with it.
 *
 * Whether a layer is rendered ignores these marks (`isRenderedModalLayer`), so a lower layer is not
 * kept out of charge by the mark the layer above it set once that layer goes or hides; each sync
 * lifts every mark and lays them again for the layer on top now.
 */
function syncBackgroundInert(ownerDocument: Document): RegisteredModalLayer | undefined {
  for (const element of [...inertBehindModal]) {
    if (element.ownerDocument !== ownerDocument) continue;
    element.removeAttribute("inert");
    inertBehindModal.delete(element);
  }
  const top = topModalLayer(ownerDocument);
  if (top !== undefined) inertOutside(top.layer.element);
  return top;
}

function inertOutside(layerElement: HTMLElement): void {
  const live = liveMarkersFor(layerElement);
  const body = layerElement.ownerDocument.body;
  let current: Element = layerElement;
  for (let parent = composedParentElement(current); parent !== null && current !== body; parent = composedParentElement(current)) {
    for (const sibling of flattenedChildElements(parent)) {
      if (sibling !== current) inertBackgroundElement(sibling, live);
    }
    current = parent;
  }
}

/** The markers that count for a layer, and every element on their way up, which must stay unmarked. */
interface LiveMarkers {
  markers: ReadonlySet<Element>;
  ancestors: ReadonlySet<Element>;
}

/**
 * The markers in each tree the layer is drawn inside: its own shadow root, every shadow root it
 * climbs out of, and the document. A marker in any other tree belongs to a component the layer
 * is not part of.
 */
function liveMarkersFor(layerElement: HTMLElement): LiveMarkers {
  const markers = new Set<Element>();
  const ancestors = new Set<Element>();
  for (const root of enclosingTreeRoots(layerElement)) {
    for (const marker of Array.from(root.querySelectorAll(`[${LIVE_BEHIND_MODAL_ATTRIBUTE}]`))) {
      markers.add(marker);
      for (let ancestor = composedParentElement(marker); ancestor !== null; ancestor = composedParentElement(ancestor)) ancestors.add(ancestor);
    }
  }
  return { markers, ancestors };
}

function enclosingTreeRoots(element: Element): (Document | ShadowRoot)[] {
  const roots: (Document | ShadowRoot)[] = [];
  for (let root = element.getRootNode(); ; root = root.host.getRootNode()) {
    if (root instanceof ShadowRoot) {
      roots.push(root);
      continue;
    }
    if (root instanceof Document) roots.push(root);
    return roots;
  }
}

function inertBackgroundElement(element: Element, live: LiveMarkers): void {
  if (!(element instanceof HTMLElement) || live.markers.has(element) || element.hasAttribute("inert")) return;
  if (live.ancestors.has(element)) {
    for (const child of flattenedChildElements(element)) inertBackgroundElement(child, live);
    return;
  }
  element.setAttribute("inert", "");
  inertBehindModal.add(element);
}

/**
 * A registered layer hidden or shown again by a view switch or responsive CSS changes which layer
 * is on top without registering anything; its box going to zero or coming back is the signal, so
 * the background is not left inert behind a modal nobody can see.
 */
function observeRenderedChange(element: HTMLElement, onChange: () => void): ResizeObserver | undefined {
  const Observer = element.ownerDocument.defaultView?.ResizeObserver;
  if (Observer === undefined) return undefined;
  const observer = new Observer(onChange);
  observer.observe(element);
  return observer;
}

function topModalLayer(ownerDocument: Document): RegisteredModalLayer | undefined {
  let top: RegisteredModalLayer | undefined;
  for (const registered of registeredModalLayers) {
    if (!isRenderedModalLayer(ownerDocument, registered)) continue;
    if (top === undefined || compareModalPaintOrder(registered, top) > 0) top = registered;
  }
  return top;
}

/**
 * A registered layer owns modality only while it is actually rendered. A view
 * switch or responsive CSS can hide a still-connected custom layer - the
 * workspace upload review disappears with its panel when the main view leaves
 * the workspace - and a hidden layer that kept counting would suppress global
 * shortcuts, prompt focus, and unread acknowledgement with nothing on screen to
 * dismiss and no obvious recovery.
 *
 * Native top-layer dialogs are exempt: their modality belongs to the browser
 * from `showModal()` until `close()`, and hosts must register before that call
 * to capture the pre-modal focus target, while the dialog is still hidden as an
 * unopened `dialog` element.
 */
function isRenderedModalLayer(ownerDocument: Document, registered: RegisteredModalLayer): boolean {
  const { element, nativeTopLayer } = registered.layer;
  if (!element.isConnected || element.ownerDocument !== ownerDocument) return false;
  return nativeTopLayer === true || !isHiddenOrInertInComposedTree(element, inertBehindModal);
}

function containingModalLayer(ownerDocument: Document, node: Element): RegisteredModalLayer | undefined {
  let top: RegisteredModalLayer | undefined;
  for (const registered of registeredModalLayers) {
    if (!isRenderedModalLayer(ownerDocument, registered)
      || !composedContains(registered.layer.element, node)) continue;
    if (top === undefined || compareModalPaintOrder(registered, top) > 0) top = registered;
  }
  return top;
}

/** Compare native top-layer ownership, then paint order, then registration order. */
function compareModalPaintOrder(left: RegisteredModalLayer, right: RegisteredModalLayer): number {
  const nativeLayerDifference = Number(left.layer.nativeTopLayer === true) - Number(right.layer.nativeTopLayer === true);
  if (nativeLayerDifference !== 0) return nativeLayerDifference;
  const paintDifference = compareStackingOrder(left.layer.paintElement ?? left.layer.element, right.layer.paintElement ?? right.layer.element);
  return paintDifference !== 0 ? paintDifference : left.order - right.order;
}

/**
 * Which of two elements paints above the other, read from the z-indexed ancestors each one sits
 * in. Ranking by one element's z-index put a plugin dialog or the app's confirm under Settings:
 * the dialog's shadow host has no z-index, while Settings' host has the dialog layer, so the
 * registry made the dialog drawn on top inert (next-16 review P0). The two chains are compared
 * where they part: the higher z-index paints above, and equal ones paint in flat-tree order. A
 * fixed position, a transform or opacity also starts a stacking context in CSS; every layer here
 * signals its stacking with a z-index.
 */
function compareStackingOrder(left: HTMLElement, right: HTMLElement): number {
  const leftChain = zIndexedAncestors(left);
  const rightChain = zIndexedAncestors(right);
  let depth = 0;
  while (depth < leftChain.length && leftChain[depth]?.element === rightChain[depth]?.element) depth += 1;
  const leftEntry = leftChain[depth];
  const rightEntry = rightChain[depth];
  const zDifference = (leftEntry?.zIndex ?? 0) - (rightEntry?.zIndex ?? 0);
  if (zDifference !== 0) return zDifference;
  return compareFlatTreeOrder(leftEntry?.element ?? left, rightEntry?.element ?? right);
}

interface ZIndexedAncestor {
  element: Element;
  zIndex: number;
}

/** The element and its flat-tree ancestors that set a z-index, outermost first. */
function zIndexedAncestors(element: Element): ZIndexedAncestor[] {
  const view = element.ownerDocument.defaultView;
  const chain: ZIndexedAncestor[] = [];
  for (let current: Element | null = element; current !== null; current = composedParentElement(current)) {
    const zIndex = view?.getComputedStyle(current).zIndex ?? "";
    if (zIndex === "" || zIndex === "auto") continue;
    const parsed = Number.parseFloat(zIndex);
    chain.unshift({ element: current, zIndex: Number.isFinite(parsed) ? parsed : 0 });
  }
  return chain;
}

/** Negative when `left` comes first in the flat tree (an ancestor comes before its descendants). */
function compareFlatTreeOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  const leftPath = flatTreePath(left);
  const rightPath = flatTreePath(right);
  let depth = 0;
  while (depth < leftPath.length && leftPath[depth] === rightPath[depth]) depth += 1;
  const leftBranch = leftPath[depth];
  const rightBranch = rightPath[depth];
  if (leftBranch === undefined) return -1;
  if (rightBranch === undefined) return 1;
  const parent = leftPath[depth - 1];
  if (parent === undefined) return 0;
  const siblings = flattenedChildElements(parent);
  return siblings.indexOf(leftBranch) - siblings.indexOf(rightBranch);
}

function flatTreePath(element: Element): Element[] {
  const path: Element[] = [];
  for (let current: Element | null = element; current !== null; current = composedParentElement(current)) path.unshift(current);
  return path;
}

/**
 * Focus re-lays the background marks only when the layer sits under one of them, which happens
 * when the layer above it hid before the resize observer reported it; otherwise focusing, which
 * a host may do on every update, leaves the marks alone.
 */
function focusModalLayer(registered: RegisteredModalLayer): boolean {
  const ownerDocument = registered.layer.element.ownerDocument;
  if (underBackgroundMark(registered.layer.element)) notifyModalLayers(ownerDocument);
  if (topModalLayer(ownerDocument) !== registered) return false;
  registered.layer.focus();
  const active = deepActiveElement(registered.layer.element.ownerDocument);
  return active !== null && composedContains(registered.layer.element, active);
}

function underBackgroundMark(element: Element): boolean {
  for (let current: Element | null = element; current !== null; current = composedParentElement(current)) {
    if (current instanceof HTMLElement && inertBehindModal.has(current)) return true;
  }
  return false;
}

function restoreFocus(path: readonly HTMLElement[]): boolean {
  for (const target of path) {
    if (focusElement(target)) return true;
  }
  return false;
}

export function focusElement(target: HTMLElement): boolean {
  if (!target.isConnected || target.matches(":disabled") || isHiddenOrInertInComposedTree(target)) return false;
  target.focus();
  const active = deepActiveElement(target.ownerDocument);
  return active === target || (active !== null && composedContains(target, active));
}

/** Deepest element holding focus, resolving through nested shadow roots. */
export function deepActiveElement(ownerDocument: Document): Element | null {
  let active: Element | null = ownerDocument.activeElement;
  while (active instanceof HTMLElement) {
    const deeper: Element | null = active.shadowRoot?.activeElement ?? null;
    if (deeper === null) return active;
    active = deeper;
  }
  // happy-dom reports activeElement as undefined when nothing is focused;
  // normalize that runtime value even though the DOM type says Element | null.
  return active ?? null;
}

/**
 * Hidden/inert content is unavailable as a viable focus target. `ignoredInert` names inert marks
 * that do not count: whether a modal layer is rendered must not depend on the background marks
 * the layer above it put on it.
 */
export function isHiddenOrInertInComposedTree(element: HTMLElement, ignoredInert: ReadonlySet<Element> = new Set()): boolean {
  const view = element.ownerDocument.defaultView;
  const elementStyle = view?.getComputedStyle(element);
  if (elementStyle?.visibility === "hidden" || elementStyle?.visibility === "collapse") return true;

  let current: Element | null = element;
  while (current !== null) {
    if (current.hasAttribute("hidden") || (current.hasAttribute("inert") && !ignoredInert.has(current))) return true;
    const style = view?.getComputedStyle(current);
    if (style?.display === "none" || style?.getPropertyValue("content-visibility") === "hidden") return true;
    current = composedParentElement(current);
  }
  return false;
}

/**
 * An element's children as they render: open shadow roots replace a host's light children, and
 * slots insert their assigned children where the slot is rendered. A slot with an empty assigned
 * list keeps its fallback content, as some DOM implementations report; assigned text keeps the list
 * nonempty and suppresses the fallback.
 */
export function flattenedChildElements(parent: Element | ShadowRoot): Element[] {
  if (parent instanceof HTMLSlotElement) {
    const assigned = parent.assignedNodes({ flatten: true });
    const rendered = assigned.length === 0 ? parent.childNodes : assigned;
    return Array.from(rendered).filter((node): node is Element => node instanceof Element);
  }
  const renderedRoot = parent instanceof Element ? parent.shadowRoot ?? parent : parent;
  return Array.from(renderedRoot.children);
}

function composedParentElement(element: Element): Element | null {
  const assignedSlot = element.assignedSlot;
  if (assignedSlot instanceof HTMLSlotElement) return assignedSlot;
  const parent = element.parentElement;
  if (parent instanceof Element) return parent;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof Element ? root.host : null;
}

/** Whether `node` is contained in `host` across open shadow boundaries. */
export function composedContains(host: Element, node: Node): boolean {
  let current: Node = node;
  for (;;) {
    if (current === host) return true;
    // happy-dom reports missing or bogus parents (undefined, or even the node
    // itself) at shadow boundaries, so guard the plain DOM climb carefully.
    const parent: Node | null = current.parentNode;
    if (parent != null && parent !== current) {
      current = parent;
      continue;
    }
    const root = current instanceof ShadowRoot ? current : current.getRootNode();
    if (!(root instanceof ShadowRoot)) return false;
    current = root.host;
  }
}
