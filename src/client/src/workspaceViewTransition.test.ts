import { describe, expect, it } from "vitest";
import { workspaceViewTransition } from "./workspaceViewTransition";

describe("workspaceViewTransition", () => {
  it("returns to the picker when the phone loses its session in chat", () => {
    expect(workspaceViewTransition({ mobileLayout: true, hasSession: false, view: "chat" })).toBe("return-to-picker");
  });

  it("keeps a chat that still has its session", () => {
    expect(workspaceViewTransition({ mobileLayout: true, hasSession: true, view: "chat" })).toBe("keep");
  });

  it("keeps tool views - they follow the new workspace on their own", () => {
    expect(workspaceViewTransition({ mobileLayout: true, hasSession: false, view: "files:files" })).toBe("keep");
    expect(workspaceViewTransition({ mobileLayout: true, hasSession: false, view: "workspace:git" })).toBe("keep");
  });

  it("keeps the navigation view - the picker is already on screen", () => {
    expect(workspaceViewTransition({ mobileLayout: true, hasSession: false, view: "navigation" })).toBe("keep");
  });

  it("keeps the desktop empty chat next to its resident session list", () => {
    expect(workspaceViewTransition({ mobileLayout: false, hasSession: false, view: "chat" })).toBe("keep");
    expect(workspaceViewTransition({ mobileLayout: false, hasSession: true, view: "chat" })).toBe("keep");
  });
});
