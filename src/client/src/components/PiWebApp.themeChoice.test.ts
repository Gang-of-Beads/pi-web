// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { PiWebApp } from "./PiWebApp";

/**
 * An explicit theme pick wins outright. The owner chose Clay Paper under
 * system dark, the auto pair-binding kept rendering the dark member, and the
 * light theme read as broken. Picking a theme now turns auto off; following
 * the system again is the Auto toggle's own deliberate act.
 */
describe("an explicit theme pick wins over the system preference", () => {
  it("turns auto off when a specific theme is chosen", () => {
    const app = new PiWebApp();
    Reflect.set(app, "themePreference", { themeId: "themes:clay-soft", auto: true });
    Reflect.set(app, "applyPreferredTheme", () => undefined);
    Reflect.set(app, "plugins", { getThemes: () => [{ id: "themes:clay-paper", name: "Clay Paper", description: "", order: 1, colorScheme: "light", tokens: {} }] });

    const select: unknown = Reflect.get(app, "selectTheme");
    if (typeof select !== "function") throw new Error("selectTheme unavailable");
    Reflect.apply(select, app, ["themes:clay-paper"]);

    expect(Reflect.get(app, "themePreference")).toEqual({ themeId: "themes:clay-paper", auto: false });
  });
});
