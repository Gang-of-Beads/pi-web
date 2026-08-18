// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { SessionSubagentInfo } from "../../../shared/apiTypes";
import { ChatView, subagentRows } from "./ChatView";

const SUBAGENTS: SessionSubagentInfo[] = [
  { sessionId: "01a0child-0001-0000-000000000001", cwd: "/repo/.pi/sub", status: "working" },
  { sessionId: "01a0child-0002-0000-000000000002", cwd: "/repo/.pi/sub", status: "idle" },
];

async function mount(subagents: readonly SessionSubagentInfo[]): Promise<{ host: HTMLElement | DocumentFragment; onOpenSubagent: ReturnType<typeof vi.fn> }> {
  const view = new ChatView();
  view.sessionId = "parent-1";
  view.subagents = subagents;
  const onOpenSubagent = vi.fn<(info: SessionSubagentInfo) => void>();
  view.onOpenSubagent = onOpenSubagent;
  document.body.append(view);
  await view.updateComplete;
  return { host: view.renderRoot, onOpenSubagent };
}

describe("subagents strip", () => {
  it("shows each subagent with its status and opens one on tap", async () => {
    const { host, onOpenSubagent } = await mount(SUBAGENTS);

    const rows = [...host.querySelectorAll(".subagent-row")];
    expect(rows.length).toBe(2);
    expect(host.textContent).toContain("Subagents (2)");
    expect(host.textContent).toContain("Working");
    expect(rows[0]?.getAttribute("aria-label")).toBe("Working subagent 00000001");
    expect(rows[1]?.getAttribute("aria-label")).toBe("idle subagent 00000002");

    rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSubagent).toHaveBeenCalledExactlyOnceWith(SUBAGENTS[0]);
  });

  it("renders nothing when the session has no subagents", async () => {
    const { host } = await mount([]);
    expect(host.querySelector(".subagents-strip")).toBeNull();
  });
});

// The pure seam: rendered rows derive their fields once, so the strip stays a
// dumb map and this shape is what the template consumes.
describe("subagentRows", () => {
  it("shortens ids and labels status with a caption word", () => {
    expect(subagentRows(SUBAGENTS)).toEqual([
      { subagent: SUBAGENTS[0], shortId: "00000001", status: "working", statusLabel: "Working", cwd: "/repo/.pi/sub", ariaLabel: "Working subagent 00000001" },
      { subagent: SUBAGENTS[1], shortId: "00000002", status: "idle", statusLabel: "idle", cwd: "/repo/.pi/sub", ariaLabel: "idle subagent 00000002" },
    ]);
  });
});