import { writeClipboardText } from "../clipboard";
import { COARSE_OR_MOBILE_MEDIA_QUERY, DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY, MOBILE_NAVIGATION_MEDIA_QUERY } from "../breakpoints";
import { interactiveSurfaceStyles, listStyles } from "../components/shared";
import { describeError } from "../notice";
import type { PluginHostUi } from "./types";

/**
 * The host's own answers, handed to plugins rather than copied by them.
 *
 * Each of these is a decision this project has already paid to get right: the
 * clipboard's fallback chain, the words a failure is described with, the
 * styles that keep a tapped surface from flashing, and the breakpoints that
 * define phone behaviour. A plugin reimplementing any of them would drift from
 * the built-in surfaces the moment either side changed.
 */
export function createPluginHostUi(): PluginHostUi {
  return {
    copyText: (text) => writeClipboardText(text),
    describeError,
    surfaceStyles: interactiveSurfaceStyles,
    listStyles,
    breakpoints: {
      coarseOrMobile: COARSE_OR_MOBILE_MEDIA_QUERY,
      mobileNavigation: MOBILE_NAVIGATION_MEDIA_QUERY,
      desktopSideBySide: DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY,
    },
  };
}
