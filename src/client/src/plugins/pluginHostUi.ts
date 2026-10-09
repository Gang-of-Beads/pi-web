import { writeClipboardText } from "../clipboard";
import { COARSE_OR_MOBILE_MEDIA_QUERY, DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY, MOBILE_NAVIGATION_MEDIA_QUERY, SHORT_VIEWPORT_MEDIA_QUERY } from "../breakpoints";
import { css, unsafeCSS } from "lit";
import { disclosureIconStyle, renderDisclosureIcon } from "../components/disclosureIcon.js";
import { renderCrossIcon, uiIconStyle } from "../components/uiIcons.js";
import { actionMenuStyles, formattedTextStyles, interactiveSurfaceStyles, listStyles, workspacePanelStyles } from "../components/shared";
import { actionMenuPanelStyle } from "../components/actionMenu";
import { adoptSheets } from "../components/uiShared";
import { registerRenderedModal } from "../components/modalLayerRegistry";
import { readNamespacedString, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { renderWorkspaceMarkdownHtml } from "../formatting/workspaceMarkdown";
import { describeError } from "../notice";
import { askConfirmation } from "../confirmDialog";
import { renderPluginList } from "../components/pluginList/PluginList";
import type { PluginDialog, PluginDialogHandle, PluginHostUi } from "./types";

/**
 * The sizes of the icons this host draws for a plugin (`renderCloseIcon`, `renderDisclosureIcon`).
 * A plugin's shadow root holds only the sheets it adopts, and none of them sized a host icon, so
 * the icon drew as 0x0 there: the close key on each terminal shell tab could not be seen or
 * tapped (owner, 2026-10-08). Every root a plugin adopts host sheets into gets them.
 */
const HOST_ICON_STYLES = css`${unsafeCSS(uiIconStyle)}${unsafeCSS(disclosureIconStyle)}`;

/**
 * The app-owned dialog layer a host binds when it can present plugin dialogs.
 * The production host is the shell: dialogs render inside its dialog area with
 * the same modal-layer frame and back-gesture accounting as its own dialogs.
 */
export interface PluginDialogHost {
  showDialog(dialog: PluginDialog): PluginDialogHandle;
}

/**
 * The host's own answers, handed to plugins rather than copied by them.
 *
 * Each of these is a decision this project has already paid to get right: the
 * clipboard's fallback chain, the words a failure is described with, the
 * styles that keep a tapped surface from flashing, and the breakpoints that
 * define phone behaviour. A plugin reimplementing any of them would drift from
 * the built-in surfaces the moment either side changed.
 */
export function createPluginHostUi(dialogHost?: PluginDialogHost): PluginHostUi {
  return {
    copyText: (text) => writeClipboardText(text),
    describeError,
    adoptSheets: (root, groups) => { adoptSheets(root, [HOST_ICON_STYLES, ...groups]); },
    surfaceStyles: interactiveSurfaceStyles,
    listStyles,
    renderDisclosureIcon,
    renderCloseIcon: renderCrossIcon,
    actionMenuStyles,
    placeActionMenu: (trigger) => actionMenuPanelStyle(trigger, { constrainTo: "viewport" }),
    workspacePanelStyles,
    breakpoints: {
      coarseOrMobile: COARSE_OR_MOBILE_MEDIA_QUERY,
      mobileNavigation: MOBILE_NAVIGATION_MEDIA_QUERY,
      desktopSideBySide: DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY,
      shortViewport: SHORT_VIEWPORT_MEDIA_QUERY,
    },
    renderMarkdownHtml: (markdown) => renderWorkspaceMarkdownHtml(markdown),
    textStyles: formattedTextStyles,
    registerModal: (registration) => registerRenderedModal({
      element: registration.element,
      ...(registration.paintElement === undefined ? {} : { paintElement: registration.paintElement }),
      focus: registration.focus ?? (() => undefined),
      ...(registration.onTopChange === undefined ? {} : { onTopChange: registration.onTopChange }),
    }),
    showDialog: (dialog) => {
      if (dialogHost === undefined) throw new Error("This host does not present plugin dialogs.");
      return dialogHost.showDialog(dialog);
    },
    confirm: (request) => {
      if (dialogHost === undefined) throw new Error("This host does not present plugin dialogs.");
      return askConfirmation(dialogHost, request);
    },
    renderList: renderPluginList,
    query: {
      read: (namespace, key) => readNamespacedString(namespace, key),
      write: (namespace, key, value, options) => { setNamespacedQueryKey(namespace, key, value, options); },
    },
  };
}
