import { html } from "lit";
import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import type { PiWebPlugin } from "./types";

/**
 * PI WEB owns the chrome around the transcript (docs/design/state-diagram.md, rule 7).
 *
 * Owner, 2026-09-30: "pi web就不该支持这里注入任何bar以及元素 … 插件声明后，出来一个新的插件的按钮点击进去是
 * 插件自定义的显示". The session drawer let a plugin draw a bar between the header and the transcript;
 * it is gone. A plugin that still declares it is refused at registration with the replacement named.
 * The refusal reaches only the browser console today; showing browser registration failures on the
 * plugin card is B38.
 */
describe("contribution points that drew over the transcript", () => {
  it("refuses a plugin that still declares drawerSections, and names the page contribution instead", () => {
    const legacy: PiWebPlugin = {
      apiVersion: 2,
      name: "Legacy",
      activate: () => ({ contributions: Object.fromEntries([["drawerSections", [{ id: "x", title: "X", render: () => html`` }]]]) }),
    };
    const registry = new PluginRegistry();
    expect(() => { registry.register({ id: "legacy", plugin: legacy }); }).toThrow(/drawerSections.*removed.*workspacePanels/u);
    expect(registry.hasPlugin("legacy")).toBe(false);
  });

  it("still takes a plugin page", () => {
    const pages: PiWebPlugin = {
      apiVersion: 2,
      name: "Pages",
      activate: () => ({ contributions: { workspacePanels: [{ id: "page", title: "Page", render: () => html`` }] } }),
    };
    const registry = new PluginRegistry();
    registry.register({ id: "pages", plugin: pages });
    expect(registry.hasPlugin("pages")).toBe(true);
  });
});
