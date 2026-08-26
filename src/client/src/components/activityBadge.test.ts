// @vitest-environment happy-dom

import { render, type TemplateResult } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { hasStatusUnread, renderActionActivityIndicator, renderActivityIndicator, renderSessionStateBadge, statusActivityKind } from "./activityBadge";

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

describe("statusActivityKind", () => {
  it("prefers work in progress over a live terminal", () => {
    expect(statusActivityKind({ "core:working": true, "core:terminal": true })).toBe("session");
    expect(statusActivityKind({ "core:terminal": true })).toBe("terminal");
  });

  it("treats unread as attention rather than work", () => {
    expect(statusActivityKind({ "core:unread": true })).toBeUndefined();
    expect(hasStatusUnread({ "core:unread": true })).toBe(true);
    expect(hasStatusUnread({ "core:working": true })).toBe(false);
  });

  it("falls back to the generic work mark for a flag id this build does not know", () => {
    expect(statusActivityKind({ "core:future": true })).toBe("session");
  });

  it("shows nothing for a node with no set flag and for a machine with no snapshot", () => {
    expect(statusActivityKind({ "core:working": false })).toBeUndefined();
    expect(statusActivityKind(undefined)).toBeUndefined();
    expect(hasStatusUnread(undefined)).toBe(false);
  });
});


function renderInto(template: TemplateResult | undefined): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(template ?? null, container);
  return container;
}

describe("renderSessionStateBadge", () => {
  it("renders three bouncing dots for working with a clear label", () => {
    const container = renderInto(renderSessionStateBadge("working"));
    const dots = container.querySelectorAll(".state-dot");
    expect(dots.length).toBe(3);
    expect(container.querySelector(".session-state.working")?.getAttribute("aria-label")).toBe("Session is working");
  });

  it("renders a static dot colored by state for idle, asking, and error", () => {
    const idle = renderInto(renderSessionStateBadge("idle"));
    expect(idle.querySelector(".session-state.idle")?.getAttribute("aria-label")).toBe("Session is done");
    const asking = renderInto(renderSessionStateBadge("asking"));
    expect(asking.querySelector(".session-state.asking")?.getAttribute("aria-label")).toBe("Waiting for your answer");
    const error = renderInto(renderSessionStateBadge("error"));
    expect(error.querySelector(".session-state.error")?.getAttribute("aria-label")).toBe("Session hit an error");
  });

  it("renders nothing when there is no state and nothing unread", () => {
    expect(renderInto(renderSessionStateBadge(undefined)).querySelector(".session-state")).toBeNull();
  });

  it("wraps unread as a ring like the work indicators", () => {
    const container = renderInto(renderSessionStateBadge("working", "Unread session activity"));
    const ring = container.querySelector(".unread-ring");
    expect(ring?.getAttribute("aria-label")).toBe("Unread session activity · Session is working");
    expect(ring?.querySelector(".state-dots .state-dot")?.getAttribute("aria-hidden")).toBeNull();
  });

  it("colors idle gray when read and green when unread, without a ring", () => {
    const read = renderInto(renderSessionStateBadge("idle"));
    expect(read.querySelector(".session-state.idle")?.classList.contains("unread")).toBe(false);

    const unread = renderInto(renderSessionStateBadge("idle", "Unread session activity"));
    const dot = unread.querySelector(".session-state.idle.unread");
    expect(dot?.getAttribute("aria-label")).toBe("Unread session activity · Session is done");
    expect(unread.querySelector(".unread-ring")).toBeNull();
  });
});
