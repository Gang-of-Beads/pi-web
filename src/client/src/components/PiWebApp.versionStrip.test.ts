// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import "./PiWebApp";
import type { PiWebApp } from "./PiWebApp";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * `location.reload()` handed a phone the page it already had, so the strip came back and offered
 * the reload again (owner, 2026-11-23). The reload navigates to a URL no cache has seen.
 */
describe("the version strip's reload", () => {
  it("navigates to a fresh URL so a cached page cannot come back", async () => {
    document.body.innerHTML = "<pi-web-app></pi-web-app>";
    const app = document.body.querySelector<PiWebApp>("pi-web-app");
    if (app === null) throw new Error("the app did not mount");
    Reflect.set(app, "versionStrip", { kind: "reload", serverVersion: "2.0.0" });
    app.requestUpdate();
    await app.updateComplete;
    const button = [...app.renderRoot.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Reload");
    if (button === undefined) throw new Error("the strip drew no Reload button");

    const replaced: string[] = [];
    const original = window.location.replace.bind(window.location);
    Reflect.set(window.location, "replace", (url: string) => { replaced.push(url); });
    try {
      button.click();
    } finally {
      Reflect.set(window.location, "replace", original);
    }

    expect(replaced.length).toBe(1);
    expect(replaced[0]).toContain("__reload=");
  });
});
