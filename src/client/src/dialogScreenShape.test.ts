import { describe, expect, it } from "vitest";
import { classifyScreen, stripFrame } from "./dialogScreenShape.js";

const confirmation = [
  "┌─────────────────────────────┐",
  "│ Task list confirmation      │",
  "├─────────────────────────────┤",
  "│ Proposed task list:         │",
  "│                             │",
  "│ [ ] task-1: filter study    │",
  "│ [ ] task-2: manipulation    │",
  "├─────────────────────────────┤",
  "│  ▸ Confirm task list        │",
  "│    Keep current tasks       │",
  "├─────────────────────────────┤",
  "│ Enter to select · Esc = back│",
  "└─────────────────────────────┘",
];

describe("reading a screen's shape", () => {
  it("reads the confirmation as a titled menu with the body above it", () => {
    const shape = classifyScreen(confirmation);
    expect(shape.kind).toBe("menu");
    if (shape.kind !== "menu") return;
    expect(shape.title).toBe("Task list confirmation");
    expect(shape.options.map((option) => option.label)).toEqual(["Confirm task list", "Keep current tasks"]);
    expect(shape.options[0]?.current).toBe(true);
    expect(shape.body).toEqual(["Proposed task list:", "", "[ ] task-1: filter study", "[ ] task-2: manipulation"]);
    // No frame characters left anywhere.
    expect(JSON.stringify(shape).includes("│")).toBe(false);
    expect(JSON.stringify(shape).includes("─")).toBe(false);
  });

  it("does not turn a task list into options", () => {
    const shape = classifyScreen(["│ [ ] one", "│ [ ] two", "│ ▸ Go", "│   Wait"]);
    expect(shape.kind).toBe("menu");
    if (shape.kind !== "menu") return;
    expect(shape.title).toBeUndefined();
    expect(shape.options.map((option) => option.label)).toEqual(["Go", "Wait"]);
    expect(shape.body).toEqual(["[ ] one", "[ ] two"]);
  });

  it("reads a heading drawn flush above the options as the heading, not as one more option", () => {
    const shape = classifyScreen(["ui-custom probe · tap a line or press a key", "▸ first      ", "  second     ", "  third      ", "enter to select · esc to close"]);
    expect(shape.kind).toBe("menu");
    if (shape.kind !== "menu") return;
    expect({ title: shape.title, options: shape.options.map((option) => option.label) }).toEqual({ title: "ui-custom probe · tap a line or press a key", options: ["first", "second", "third"] });
  });

  it("keeps siblings drawn one column left of a cursor that sits a space deeper", () => {
    const shape = classifyScreen(["Pick", " ▸ one", "  two", "  three"]);
    expect(shape.kind === "menu" ? shape.options.map((option) => option.label) : []).toEqual(["one", "two", "three"]);
  });

  it("keeps siblings that carry their own marker", () => {
    const shape = classifyScreen(["Pick", "▸ one", "○ two", "○ three"]);
    expect(shape.kind === "menu" ? shape.options.map((option) => option.label) : []).toEqual(["one", "○ two", "○ three"]);
  });

  it("stays text when nothing looks like a menu", () => {
    const shape = classifyScreen(["│ a plain progress screen", "│ 42% done"]);
    expect(shape.kind).toBe("text");
  });

  it("keeps a single option as text", () => {
    expect(classifyScreen(["│ Status:", "│ ▸ One"]).kind).toBe("text");
  });

  it("strips only the frame", () => {
    expect(stripFrame("│  ▸ Confirm   │")).toBe("▸ Confirm");
    expect(stripFrame("  plain  ")).toBe("plain");
  });
});
