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
