// @vitest-environment happy-dom

import { render, type TemplateResult } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { renderActionActivityIndicator, renderActivityIndicator } from "./activityBadge";

afterEach(() => {
  document.body.replaceChildren();
});

describe("renderActivityIndicator", () => {
  it("renders nothing when the row is idle and read", () => {
    const container = renderInto(renderActivityIndicator(undefined, "Machine active"));

    expect(container.querySelector(".activity-indicator, .unread-ring")).toBeNull();
  });

  it("renders a bare work dot when the row is active and read", () => {
    const container = renderInto(renderActivityIndicator("session", "Machine active"));

    const dot = container.querySelector(".activity-indicator.session");
    expect(dot?.getAttribute("aria-label")).toBe("Machine active");
    expect(container.querySelector(".unread-ring")).toBeNull();
  });

  it("renders a filled unread dot when the row is idle and unread", () => {
    const container = renderInto(renderActivityIndicator(undefined, "Machine active", "Unread sessions on this machine"));

    const dot = container.querySelector(".activity-indicator.unread");
    expect(dot?.getAttribute("title")).toBe("Unread sessions on this machine");
    expect(container.querySelector(".unread-ring")).toBeNull();
  });

  it("wraps the work dot in an unread ring when the row is active and unread", () => {
    const container = renderInto(renderActivityIndicator("terminal", "Machine terminal active", "Unread sessions on this machine"));

    const ring = container.querySelector(".unread-ring");
    expect(ring?.getAttribute("role")).toBe("img");
    expect(ring?.getAttribute("aria-label")).toBe("Unread sessions on this machine · Machine terminal active");
    const dot = ring?.querySelector(".activity-indicator.terminal");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    // One mark only: the ring replaces the standalone unread dot.
    expect(container.querySelector(".activity-indicator.unread")).toBeNull();
  });
});

describe("renderActionActivityIndicator", () => {
  it("slots the composite mark into the row corner", () => {
    const container = renderInto(renderActionActivityIndicator("session", "Session active", "Unread session activity"));

    const slot = container.querySelector(".action-activity");
    expect(slot?.querySelector(".unread-ring .activity-indicator.session")).not.toBeNull();
  });

  it("renders no slot when there is nothing to show", () => {
    const container = renderInto(renderActionActivityIndicator(undefined));

    expect(container.querySelector(".action-activity")).toBeNull();
  });
});

function renderInto(template: TemplateResult | undefined): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(template ?? null, container);
  return container;
}
