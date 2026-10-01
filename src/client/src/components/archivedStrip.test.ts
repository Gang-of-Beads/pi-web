// @vitest-environment happy-dom
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderArchivedStrip } from "./archivedStrip";

afterEach(() => { document.body.replaceChildren(); });

describe("the composer slot of an archived session (P2 slice b part 2, G4)", () => {
  it("says the session is archived and restores it when Restore is tapped", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onRestore = vi.fn();

    render(renderArchivedStrip(onRestore, false), container);
    const strip = container.querySelector(".archived-strip");
    const restore = container.querySelector("button");
    restore?.click();

    expect({ role: strip?.getAttribute("role"), text: strip?.querySelector("p")?.textContent, button: restore?.textContent, restored: onRestore.mock.calls.length }).toEqual({
      role: "status",
      text: "This session is archived.",
      button: "Restore",
      restored: 1,
    });
  });

  it("takes no second tap while a restore is on its way", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onRestore = vi.fn();

    render(renderArchivedStrip(onRestore, true), container);
    const restore = container.querySelector("button");
    restore?.click();

    expect({ disabled: restore?.disabled, restored: onRestore.mock.calls.length }).toEqual({ disabled: true, restored: 0 });
  });
});
