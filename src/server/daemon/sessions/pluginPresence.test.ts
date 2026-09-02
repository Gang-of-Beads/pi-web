import { describe, expect, it } from "vitest";
import { pluginPresence, type LoadedExtensionsView } from "./pluginPresence.js";

/**
 * Whether a plugin-backed surface has anything behind it.
 *
 * The interface never asked. The Goals tab rendered unconditionally and the
 * server read the workspace's `.pi/goals` directory, so a plugin nobody
 * installed and a plugin with no data yet looked identical - a permanent empty
 * panel with nothing saying why. A user reported the same shape for subagents.
 *
 * The runtime does know: `ResourceLoader.getExtensions()` returns the loaded
 * extensions and the ones that failed to load. Three states follow, and the
 * third is the reason this is not a boolean: an extension that threw on load is
 * neither absent nor working, and reporting it as absent hides a broken install
 * behind a tidy empty state.
 *
 * The question asked is "does anything provide these tools", not "is package X
 * installed". This repository runs a fork of the goal plugin, so a name match
 * would have been wrong on the first day.
 */

function view(over: Partial<LoadedExtensionsView> = {}): LoadedExtensionsView {
  return { extensions: [], errors: [], ...over };
}

describe("deciding whether a plugin surface has a provider", () => {
  it("reports absent when no loaded extension registers the tools", () => {
    expect(pluginPresence(view(), ["create_goal"])).toEqual({ state: "absent" });
  });

  it("reports present when one does", () => {
    const loaded = view({ extensions: [{ path: "goal.ts", tools: ["create_goal", "update_goal"] }] });

    expect(pluginPresence(loaded, ["create_goal"])).toEqual({ state: "present" });
  });

  it("accepts any one of the tools a surface can be provided by", () => {
    const loaded = view({ extensions: [{ path: "goal.ts", tools: ["update_goal"] }] });

    expect(pluginPresence(loaded, ["create_goal", "update_goal"])).toEqual({ state: "present" });
  });

  /** The state that makes this three-valued rather than a boolean. */
  it("reports failed when an extension could not load, rather than calling it absent", () => {
    const loaded = view({ errors: [{ path: "/x/goal.ts", error: "boom" }] });

    expect(pluginPresence(loaded, ["create_goal"])).toEqual({ state: "failed", errors: ["boom"] });
  });

  it("prefers a working provider over an unrelated load failure", () => {
    const loaded = view({
      extensions: [{ path: "goal.ts", tools: ["create_goal"] }],
      errors: [{ path: "/x/other.ts", error: "unrelated" }],
    });

    expect(pluginPresence(loaded, ["create_goal"])).toEqual({ state: "present" });
  });

  it("carries every load error, so one failure does not hide another", () => {
    const loaded = view({ errors: [{ path: "/a.ts", error: "a" }, { path: "/b.ts", error: "b" }] });

    expect(pluginPresence(loaded, ["create_goal"])).toEqual({ state: "failed", errors: ["a", "b"] });
  });

  it("treats a surface with no tools named as absent rather than present", () => {
    const loaded = view({ extensions: [{ path: "goal.ts", tools: ["create_goal"] }] });

    expect(pluginPresence(loaded, [])).toEqual({ state: "absent" });
  });
});
