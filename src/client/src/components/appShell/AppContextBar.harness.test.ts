// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../../api";
import { AppContextBar } from "./AppContextBar";

afterEach(() => { document.body.replaceChildren(); });

function required(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing required element: ${selector}`);
  return element;
}

describe("the resident row hands off to the panel and the quick switcher", () => {
  function session(patch: Partial<SessionInfo> = {}): SessionInfo {
    return {
      id: "019f22c5-d53e-7489-997f-fce17c4dc82f",
      cwd: "/repo",
      path: "/repo/.pi/session.jsonl",
      created: "2026-08-28T10:00:00.000Z",
      modified: "2026-08-28T10:00:00.000Z",
      messageCount: 0,
      firstMessage: "",
      ...patch,
    };
  }

  async function mount(overrides: Partial<AppContextBar> = {}): Promise<AppContextBar> {
    const bar = new AppContextBar();
    Object.assign(bar, overrides);
    document.body.append(bar);
    await bar.updateComplete;
    return bar;
  }

  it("toggles the panel from the leading slot", async () => {
    const toggles: boolean[] = [];
    const bar = await mount({ panelOpen: false, onTogglePanel: () => { toggles.push(true); } });
    const toggle = required(bar.renderRoot, ".panel-toggle");

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();

    expect(toggles).toHaveLength(1);
  });

  it("opens the quick switcher from the session name", async () => {
    const switches: boolean[] = [];
    const bar = await mount({ session: session({ name: "Ship the release" }), onQuickSwitch: () => { switches.push(true); } });

    required(bar.renderRoot, ".session-title").click();

    expect(switches).toHaveLength(1);
  });

  it("offers the empty honestly when no session is selected", async () => {
    const switches: boolean[] = [];
    const bar = await mount({ onQuickSwitch: () => { switches.push(true); } });
    const title = required(bar.renderRoot, ".session-title");

    expect(title.textContent).toBe("Sessions");
    title.click();

    expect(switches).toHaveLength(1);
  });

  it("shows the working indicator only while the session works", async () => {
    const bar = await mount({ session: session({ name: "Ship the release" }), isWorking: true });
    expect(bar.renderRoot.querySelectorAll(".working-dot").length).toBe(3);

    bar.isWorking = false;
    await bar.updateComplete;

    expect(bar.renderRoot.querySelector(".working")).toBeNull();
  });
});
