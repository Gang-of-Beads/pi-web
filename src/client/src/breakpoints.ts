/**
 * The layout lines of this application, named once.
 *
 * The parity review found the 760px line written three times in three
 * mechanisms, a 420 and a 430 and a container-430 dividing nothing, and two
 * modals going full-bleed 80px apart - every one a copy that nothing linked
 * to its siblings, each free to drift alone. A breakpoint that exists in one
 * place cannot disagree with itself.
 *
 * Component CSS interpolates these numbers; TypeScript matchMedia consumers
 * derive their query strings from the same values. Container queries are
 * content-local by design and exempt: a dialog grid collapsing at some inner
 * width is that dialog's business, not a device line.
 */

/** Phones in one hand. Below this, the tightest spacing and column layouts. */
export const NARROW_PHONE_MAX_PX = 430;

/** The chat column tightens its chrome below this; established, tested line. */
export const NARROW_CHAT_MAX_PX = 640;

/** The mobile navigation layout: nav becomes a layer, the context bar appears. */
export const MOBILE_NAVIGATION_MAX_PX = 760;

/** Chat and a workspace tool render side by side from this width up. */
export const WORKSPACE_SIDE_BY_SIDE_MIN_PX = 1181;

/** Short viewports (a phone keyboard up): vertical chrome shrinks. */
export const SHORT_VIEWPORT_MAX_PX = 620;

export const MOBILE_NAVIGATION_MEDIA_QUERY = `(max-width: ${String(MOBILE_NAVIGATION_MAX_PX)}px)`;
export const DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY = `(min-width: ${String(WORKSPACE_SIDE_BY_SIDE_MIN_PX)}px)`;
export const SHORT_VIEWPORT_MEDIA_QUERY = `(max-height: ${String(SHORT_VIEWPORT_MAX_PX)}px)`;

/**
 * Coarse pointers get phone behavior at any width; small windows get it on any
 * pointer. The compound is derived here so its copies cannot drift from the
 * mobile line. It names touch behaviour (the Enter key, plugin hosts); the
 * layout is PHONE_LAYOUT_MEDIA_QUERY.
 */
export const COARSE_OR_MOBILE_MEDIA_QUERY = `(pointer: coarse), ${MOBILE_NAVIGATION_MEDIA_QUERY}`;

/**
 * A touch screen this wide gets the desktop layout: every iPad held landscape
 * (1080 to 1376) clears it, every phone held landscape (956 at most) and every
 * tablet held upright stays under it (owner, 2026-10-16: an iPad in landscape
 * showed the phone layout).
 */
export const TOUCH_DESKTOP_MIN_PX = 1080;

/**
 * The phone layout: a small window on any pointer, or a touch screen narrower
 * than TOUCH_DESKTOP_MIN_PX. Written as one level-4 condition so
 * `not (${"..."})` negates it whole.
 */
export const PHONE_LAYOUT_MEDIA_QUERY = `${MOBILE_NAVIGATION_MEDIA_QUERY} or ((pointer: coarse) and (max-width: ${String(TOUCH_DESKTOP_MIN_PX - 1)}px))`;
