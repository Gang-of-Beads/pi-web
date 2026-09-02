import { describe, expect, it } from "vitest";
import { loadedExtensionsView } from "./pluginPresence.js";

/**
 * The runtime reports an extension's tools as a Map; the decision wants names.
 *
 * A runtime that predates `getExtensions` must not make the surface claim the
 * plugin is absent - that is the failure this whole change exists to remove, so
 * an unavailable source is reported as unknown rather than as a fact.
 */

describe("reading the runtime's extension list", () => {
  it("names the tools each extension registers", () => {
    const runtime = {
      getExtensions: () => ({
        extensions: [{ path: "goal.ts", tools: new Map([["create_goal", {}], ["update_goal", {}]]) }],
        errors: [],
      }),
    };

    expect(loadedExtensionsView(runtime)).toEqual({
      extensions: [{ path: "goal.ts", tools: ["create_goal", "update_goal"] }],
      errors: [],
    });
  });

  it("carries load errors through untouched", () => {
    const runtime = { getExtensions: () => ({ extensions: [], errors: [{ path: "/x.ts", error: "boom" }] }) };

    expect(loadedExtensionsView(runtime)?.errors).toEqual([{ path: "/x.ts", error: "boom" }]);
  });

  it("tolerates an extension that registers no tools", () => {
    const runtime = { getExtensions: () => ({ extensions: [{ path: "quiet.ts" }], errors: [] }) };

    expect(loadedExtensionsView(runtime)).toEqual({ extensions: [{ path: "quiet.ts", tools: [] }], errors: [] });
  });

  /** Unknown, not absent: a runtime without the method proves nothing. */
  it("returns undefined when the runtime cannot answer", () => {
    expect(loadedExtensionsView({})).toBeUndefined();
  });
});
