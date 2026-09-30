// @vitest-environment happy-dom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { NavigationPhase } from "../navigationIntent";
import { isOpeningKey, renderOpeningSpinner, renderOpeningWords } from "./openingMark";

const pending = (phase: NavigationPhase) => ({ key: "local:s1", label: "Session one", phase });

function drawn(template: ReturnType<typeof renderOpeningWords>): HTMLElement {
  const host = document.createElement("div");
  if (template !== undefined) render(template, host);
  return host;
}

describe("the tapped row's opening mark", () => {
  it("keeps the row's own secondary line for the first second, then says what is happening", () => {
    expect(renderOpeningWords(pending("going"), "local:s1")).toBeUndefined();
    expect(drawn(renderOpeningWords(pending("slow"), "local:s1")).textContent).toBe("Opening…");
    expect(drawn(renderOpeningWords(pending("stalled"), "local:s1")).textContent).toBe("Still opening…");
    expect(drawn(renderOpeningWords(pending("failed"), "local:s1")).querySelector(".opening-words.failed")?.textContent).toBe("Couldn't open · retry");
  });

  it("marks only the row that was tapped, and stops spinning once the open failed", () => {
    expect(renderOpeningWords(pending("slow"), "local:s2")).toBeUndefined();
    expect(isOpeningKey(pending("going"), "local:s1")).toBe(true);
    expect(isOpeningKey(pending("going"), "local:s2")).toBe(false);
    expect(isOpeningKey(pending("failed"), "local:s1")).toBe(false);
  });

  it("leaves the spoken announcement to the app, so the row's name is not read twice", () => {
    const host = document.createElement("div");
    render(renderOpeningSpinner(), host);
    expect(host.querySelector(".opening-spinner")?.getAttribute("aria-hidden")).toBe("true");
  });
});
