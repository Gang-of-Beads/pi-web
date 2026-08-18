// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationSection } from "../../appShell/navigationState";
import type { Project, SessionInfo, Workspace } from "../../api";
import { AppContextBar } from "./AppContextBar";

afterEach(() => { document.body.replaceChildren(); });

/**
 * While reading a conversation the session is the subject; the location trail
 * is only how the user got there. The session-led layout promotes the session
 * name to the heading without costing a second row.
 */
describe("app-context-bar session-led layout", () => {
  it("leads with the session name and a single breadcrumb", async () => {
    const root = await mount({ emphasizeSession: true });

    expect(root.querySelector(".context-session-title")?.textContent.trim()).toBe("Mobile UX sweep");
    expect(root.querySelector(".context-breadcrumb")?.textContent.trim()).toBe("pi-web");
    // The four-chip trail is replaced, not stacked above: height is unchanged.
    expect(root.querySelectorAll(".context-chip")).toHaveLength(0);
  });

  it("falls back to the first message when a session has no alias", async () => {
    const withoutName = { ...session() };
    delete withoutName.name;
    const root = await mount({
      emphasizeSession: true,
      session: { ...withoutName, firstMessage: "hello there" },
    });

    expect(root.querySelector(".context-session-title")?.textContent.trim()).toBe("hello there");
  });

  it("names a non-main workspace rather than repeating the project", async () => {
    const root = await mount({
      emphasizeSession: true,
      workspace: { ...workspace(), isMain: false, label: "feature-branch" },
    });

    expect(root.querySelector(".context-breadcrumb")?.textContent.trim()).toBe("feature-branch");
  });

  it("opens the workspace section from the breadcrumb", async () => {
    const onOpenSection = vi.fn();
    const root = await mount({ emphasizeSession: true, onOpenSection });

    root.querySelector<HTMLButtonElement>(".context-breadcrumb")?.click();

    expect(onOpenSection).toHaveBeenCalledWith("workspaces");
  });

  it("opens the quick switcher from the session title", async () => {
    const onQuickSwitch = vi.fn();
    const root = await mount({ emphasizeSession: true, onQuickSwitch });

    root.querySelector<HTMLButtonElement>(".context-session-title")?.click();

    expect(onQuickSwitch).toHaveBeenCalledOnce();
  });

  it("keeps the full trail when no session is selected", async () => {
    // Nothing to lead with, and the trail is what still needs a choice.
    const root = await mount({ emphasizeSession: true, session: undefined });

    expect(root.querySelector(".context-session-title")).toBeNull();
    expect(root.querySelectorAll(".context-chip").length).toBeGreaterThan(0);
  });

  it("keeps the full trail outside the chat surface", async () => {
    const root = await mount({ emphasizeSession: false });

    expect(root.querySelector(".context-session-title")).toBeNull();
    expect(root.querySelectorAll(".context-chip").length).toBeGreaterThan(0);
  });
});

async function mount(options: {
  emphasizeSession: boolean;
  session?: SessionInfo | undefined;
  workspace?: Workspace;
  onOpenSection?: (section: NavigationSection) => void;
  onQuickSwitch?: () => void;
  onRenameSession?: (name: string) => void;
  isWorking?: boolean;
}): Promise<ShadowRoot> {
  const bar = new AppContextBar();
  bar.machines = [];
  bar.project = project();
  bar.workspace = options.workspace ?? workspace();
  const selected = "session" in options ? options.session : session();
  if (selected !== undefined) bar.session = selected;
  bar.emphasizeSession = options.emphasizeSession;
  if (options.onOpenSection !== undefined) bar.onOpenSection = options.onOpenSection;
  if (options.onQuickSwitch !== undefined) bar.onQuickSwitch = options.onQuickSwitch;
  if (options.onRenameSession !== undefined) bar.onRenameSession = options.onRenameSession;
  if (options.isWorking !== undefined) bar.isWorking = options.isWorking;
  document.body.append(bar);
  await bar.updateComplete;
  const root = bar.shadowRoot;
  if (root === null) throw new Error("Expected app-context-bar shadow root");
  return root;
}

function project(): Project {
  return { id: "p1", name: "pi-web", path: "/repo/pi-web", createdAt: "2026-07-27T10:00:00.000Z" };
}

function workspace(): Workspace {
  return {
    id: "w1",
    projectId: "p1",
    path: "/repo/pi-web",
    label: "pi-web",
    isMain: true,
    effectiveConfig: { uploads: { defaultFolder: ".pi-web/uploads" } },
  };
}

function session(): SessionInfo {
  return {
    id: "session-1",
    cwd: "/repo/pi-web",
    path: "/repo/pi-web/.pi/sessions/session-1.jsonl",
    name: "Mobile UX sweep",
    created: "2026-07-27T10:00:00.000Z",
    modified: "2026-07-27T10:05:00.000Z",
    messageCount: 4,
    firstMessage: "hello there",
  };
}

/**
 * Naming the session you are reading is the common case -- it is the one whose
 * name is wrong often enough to matter, and it was reachable only by leaving the
 * conversation for the session list and finding the row again.
 */
describe("renaming the current session in place", () => {
  async function startEditing(onRenameSession: (name: string) => void): Promise<{ root: ShadowRoot; input: HTMLInputElement }> {
    const root = await mount({ emphasizeSession: true, onRenameSession });
    root.querySelector<HTMLButtonElement>(".context-session-rename")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = root.querySelector<HTMLInputElement>(".context-session-input");
    if (input === null) throw new Error("expected an inline rename input");
    return { root, input };
  }

  it("saves the edited name on Enter", async () => {
    const onRenameSession = vi.fn();
    const { input } = await startEditing(onRenameSession);

    // Seeded with the current name, so a correction is an edit rather than a retype.
    expect(input.value).toBe("Mobile UX sweep");
    input.value = "  Mobile UX sweep v2  ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onRenameSession).toHaveBeenCalledExactlyOnceWith("Mobile UX sweep v2");
  });

  it("abandons the edit on Escape", async () => {
    const onRenameSession = vi.fn();
    const { root, input } = await startEditing(onRenameSession);

    input.value = "discarded";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRenameSession).not.toHaveBeenCalled();
    // ...and the title is back, so the bar cannot be left stuck in edit mode.
    expect(root.querySelector(".context-session-title")).not.toBeNull();
  });

  it("treats an unchanged or emptied name as no rename at all", async () => {
    const onRenameSession = vi.fn();
    const { input } = await startEditing(onRenameSession);

    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onRenameSession).not.toHaveBeenCalled();

    input.value = "Mobile UX sweep";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Clearing a name by accident is the failure worth preventing here.
    expect(onRenameSession).not.toHaveBeenCalled();
  });
});

describe("working indicator", () => {
  it("shows animated dots while the session is working and hides them when idle", async () => {
    const busy = await mount({ emphasizeSession: true, isWorking: true });
    const busyDots = busy.querySelectorAll(".context-working-dot");
    expect(busyDots.length).toBe(3);
    const indicator = busy.querySelector(".context-working");
    expect(indicator?.getAttribute("role")).toBe("status");
    expect(indicator?.getAttribute("aria-label")).toBe("Session is working");

    const idle = await mount({ emphasizeSession: true, isWorking: false });
    expect(idle.querySelector(".context-working")).toBeNull();
  });
});
