import { describe, expect, it } from "vitest";
import { documentTitleFor, focusedContextName, PRODUCT_NAME } from "./contextName";
import type { SessionInfo } from "./api";

function session(fields: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "0199aa00-1111-2222-3333-444455556666",
    cwd: "/srv/projects/demo",
    path: "/srv/sessions/demo.jsonl",
    created: "2026-08-26T00:00:00.000Z",
    modified: "2026-08-26T00:00:00.000Z",
    messageCount: 2,
    firstMessage: "",
    ...fields,
  };
}

describe("focused context name", () => {
  it("names the session while reading a chat", () => {
    expect(focusedContextName({
      mainView: "chat",
      selectedSession: session({ name: "fix the queue" }),
      selectedWorkspace: { label: "pi-web" },
      selectedProject: { name: "vincent" },
    })).toBe("fix the queue");
  });

  it("falls back through workspace, project, then remote machine", () => {
    expect(focusedContextName({
      mainView: "navigation",
      selectedWorkspace: { label: "pi-web" },
      selectedProject: { name: "vincent" },
    })).toBe("pi-web");
    expect(focusedContextName({
      mainView: "navigation",
      selectedProject: { name: "vincent" },
    })).toBe("vincent");
    expect(focusedContextName({
      mainView: "navigation",
      selectedMachine: { name: "astra-mbp", kind: "remote" },
    })).toBe("astra-mbp");
  });

  it("keeps the product name when nothing is focused, and for the local machine", () => {
    expect(focusedContextName({ mainView: "navigation" })).toBe(PRODUCT_NAME);
    // "Local" is where the reader already is; it says less than the product name.
    expect(focusedContextName({
      mainView: "navigation",
      selectedMachine: { name: "Local", kind: "local" },
    })).toBe(PRODUCT_NAME);
  });

  it("names a workspace by its trailing path segment", () => {
    expect(focusedContextName({
      mainView: "navigation",
      selectedWorkspace: { label: "Desktop/vincent/projects/pi-web" },
    })).toBe("pi-web");
  });

  it("bounds the tab title so one long session cannot fill the tab strip", () => {
    const long = "a".repeat(80);
    const title = documentTitleFor({ mainView: "chat", selectedSession: session({ name: long }) });
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith("…")).toBe(true);
  });
});
