// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../api";
import { AppContextBar } from "./AppContextBar";

/**
 * Holding the session name in the bar asks to rename it (the owner's
 * request: the name is under the finger already); a plain tap still opens
 * the switcher, and the click a completed hold produces is swallowed.
 */
const session: SessionInfo = { id: "s1", cwd: "/repo", path: "/sessions/s1.jsonl", name: "opus-b", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", messageCount: 3, firstMessage: "hello" };

async function mount(): Promise<{ bar: AppContextBar; renames: SessionInfo[]; switches: number[] }> {
  const renames: SessionInfo[] = [];
  const switches: number[] = [];
  const bar = new AppContextBar();
  bar.session = session;
  bar.onRenameRequest = (target) => { renames.push(target); };
  bar.onQuickSwitch = () => { switches.push(1); };
  document.body.append(bar);
  await bar.updateComplete;
  return { bar, renames, switches };
}

function title(bar: AppContextBar): HTMLButtonElement {
  const found = bar.renderRoot.querySelector<HTMLButtonElement>(".session-title");
  if (!found) throw new Error("no session title");
  return found;
}

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

describe("holding the session name", () => {
  it("asks to rename after the hold and swallows the click that follows", async () => {
    vi.useFakeTimers();
    const { bar, renames, switches } = await mount();
    const button = title(bar);

    button.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    vi.advanceTimersByTime(700);
    button.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }));
    button.click();

    expect(renames).toEqual([session]);
    expect(switches).toEqual([]);
  });

  it("keeps a plain tap opening the switcher", async () => {
    const { bar, renames, switches } = await mount();
    const button = title(bar);

    button.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }));
    button.click();

    expect(renames).toEqual([]);
    expect(switches).toEqual([1]);
  });
});
