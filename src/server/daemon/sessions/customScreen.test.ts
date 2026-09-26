import { describe, expect, it } from "vitest";
import { customScreenHarness, extensionNameFromStack, renderCustomScreen } from "./customScreen.js";

describe("rendering a custom screen", () => {
  it("keeps the component's lines and drops the trailing blank tail", () => {
    const component = { render: (width: number) => ["one", "two", "", `w${String(width)}`] };
    expect(renderCustomScreen(component, 40)).toEqual(["one", "two", ""].concat(["w40"]));
  });

  it("bounds the screen the status payload carries", () => {
    const component = { render: () => Array.from({ length: 500 }, (_, index) => `line ${String(index)}`) };
    expect(renderCustomScreen(component, 40, 3)).toEqual(["line 0", "line 1", "line 2"]);
  });

  it("renders an empty component as no lines", () => {
    expect(renderCustomScreen({ render: () => [] })).toEqual([]);
  });

  it("answers a theme-style call with its own text and never throws on an unknown member", () => {
    // The harness answers any member call with its own last argument, so the probe
    // reads it through the same unknown-typed door the component does.
    const harness = customScreenHarness();
    const fg: unknown = Reflect.get(harness.tui, "fg");
    expect(fg instanceof Function).toBe(true);
    if (fg instanceof Function) expect(Reflect.apply(fg, harness.tui, ["accent", "hello"])).toBe("hello");
    expect(Reflect.get(harness.tui, "unknown")).toBeDefined();
  });
});

describe("naming the extension that opened a screen", () => {
  it("reads the first frame outside this host and the SDK", () => {
    const stack = [
      "Error",
      "    at openCustomScreen (/repo/dist/server/daemon/sessions/piSessionService.js:1:1)",
      "    at /Users/x/.pi/agent/extensions/ui-custom-probe.ts:12:5",
    ].join("\n");
    expect(extensionNameFromStack(stack)).toBe("ui-custom-probe");
  });

  it("names a package's directory rather than its index file", () => {
    const stack = ["Error", "    at /Users/x/.pi/agent/git/github.com/o/pi-updater/index.ts:3:1"].join("\n");
    expect(extensionNameFromStack(stack)).toBe("pi-updater");
  });

  it("says nothing when the stack has no extension frame", () => {
    expect(extensionNameFromStack(undefined)).toBeUndefined();
    expect(extensionNameFromStack("Error\n    at here")).toBeUndefined();
  });
});
