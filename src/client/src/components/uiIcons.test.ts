// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { render } from "lit";
import { renderDisclosureIcon } from "./disclosureIcon.js";
import {
  renderCheckIcon, renderCopyIcon, renderCrossIcon, renderDoubleCheckIcon, renderDownIcon,
  renderFilledDotIcon, renderPendingRingIcon, renderRecallIcon, renderResendIcon, renderRunIcon, renderUpIcon,
} from "./uiIcons.js";

/**
 * An icon has to be in the SVG namespace to draw anything.
 *
 * These marks were converted from characters to drawings, and every geometric
 * check after that agreed they were 14px and centred - because the box was
 * real. The strokes were not: the shapes were composed through a nested `html`
 * template, which puts them in the XHTML namespace, where an <svg> paints
 * nothing. The receipts under user messages, the copy and resend controls and
 * the status-bar arrows were blank for two rounds while every guard passed.
 */
const ICONS = {
  check: renderCheckIcon, copy: renderCopyIcon, cross: renderCrossIcon,
  doubleCheck: renderDoubleCheckIcon, down: renderDownIcon, filledDot: renderFilledDotIcon,
  pendingRing: renderPendingRingIcon, recall: renderRecallIcon, resend: renderResendIcon,
  run: renderRunIcon, up: renderUpIcon,
  disclosureCollapsed: () => renderDisclosureIcon(true),
  disclosureExpanded: () => renderDisclosureIcon(false),
};

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

describe("drawn marks", () => {
  it("put their shapes in the SVG namespace, so they actually paint", () => {
    const offences: string[] = [];
    for (const [name, renderIcon] of Object.entries(ICONS)) {
      const host = document.createElement("div");
      render(renderIcon(), host);
      const svg = host.querySelector("svg");
      const shape = svg?.firstElementChild ?? null;
      if (svg === null) { offences.push(`${name}: no svg`); continue; }
      if (shape === null) { offences.push(`${name}: no shape`); continue; }
      if (shape.namespaceURI !== SVG_NAMESPACE) offences.push(`${name}: shape in ${String(shape.namespaceURI)}`);
    }

    expect(offences).toEqual([]);
  });
});
