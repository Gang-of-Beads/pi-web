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

  it("names the tool page on screen when no session is selected", async () => {
    const bar = await mount({ activeSurface: "Git" });

    expect(required(bar.renderRoot, ".session-title").textContent).toBe("Git");
  });

  it("leaves session state to the activity dock and the status footer", async () => {
    const bar = await mount({ session: session({ name: "Ship the release" }) });
    expect(bar.renderRoot.querySelector(".working")).toBeNull();
  });
});

/**
 * The owner asked for the two bar keys to trade sides: the grid that opens
 * navigation leads the bar, the lines that open the panel close it.
 */
describe("AppContextBar key order", () => {
  it("puts the navigation grid first and the panel lines last", async () => {
    const bar = new AppContextBar();
    const opened: string[] = [];
    Object.assign(bar, {
      onOpenGoTo: () => { opened.push("go-to"); },
      onTogglePanel: () => { opened.push("panel"); },
    });
    document.body.append(bar);
    await bar.updateComplete;

    const keys = [...bar.renderRoot.querySelectorAll(".panel-toggle")];

    expect(keys).toHaveLength(2);
    expect(keys[0]?.classList.contains("go-to")).toBe(true);
    expect(keys[1]?.classList.contains("go-to")).toBe(false);
    bar.remove();
  });
});
