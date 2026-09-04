import { describe, expect, it } from "vitest";
import { projectPluginDirectory, projectPluginVerdict, resolveProjectPluginRoot, type ProjectPluginVerdict } from "./projectPluginVerdict";

describe("whether a project's own plugins may load", () => {
  it("loads them from a trusted project that has them", () => {
    expect(projectPluginVerdict({ trusted: true, directoryExists: true })).toBe("load");
  });

  it("withholds them from an untrusted project rather than reporting none", () => {
    expect(projectPluginVerdict({ trusted: false, directoryExists: true })).toBe("withheld-untrusted");
  });

  it("calls a project without the directory absent, trusted or not", () => {
    expect(projectPluginVerdict({ trusted: true, directoryExists: false })).toBe("absent");
    expect(projectPluginVerdict({ trusted: false, directoryExists: false })).toBe("absent");
  });

  it("has an answer for every combination of trust and presence", () => {
    const seen = new Set<ProjectPluginVerdict>();
    for (const trusted of [true, false]) {
      for (const directoryExists of [true, false]) seen.add(projectPluginVerdict({ trusted, directoryExists }));
    }

    expect([...seen].sort()).toEqual(["absent", "load", "withheld-untrusted"]);
  });

  it("keeps a project's plugins inside the project's own PI WEB directory", () => {
    expect(projectPluginDirectory("/repo")).toBe("/repo/.pi-web/plugins");
  });

  it("offers a readable root only for a trusted project", () => {
    const resolved = resolveProjectPluginRoot("/repo", { trusted: true, directoryExists: true });

    expect(resolved.root).toEqual({ path: "/repo/.pi-web/plugins", source: "project", scope: "local" });
    expect(resolved.withheld).toBeUndefined();
  });

  it("says why an untrusted project's plugins are not running", () => {
    const resolved = resolveProjectPluginRoot("/repo", { trusted: false, directoryExists: true });

    expect(resolved.root).toBeUndefined();
    expect(resolved.withheld?.message).toContain("not trusted");
    expect(resolved.withheld?.source).toBe("/repo/.pi-web/plugins");
  });

  it("says nothing at all about a project that has no plugin directory", () => {
    const resolved = resolveProjectPluginRoot("/repo", { trusted: false, directoryExists: false });

    expect(resolved.root).toBeUndefined();
    expect(resolved.withheld).toBeUndefined();
  });
});
