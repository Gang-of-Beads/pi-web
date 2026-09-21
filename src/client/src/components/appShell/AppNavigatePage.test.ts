// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import "./AppNavigatePage";
import type { AppNavigatePage } from "./AppNavigatePage";
import type { SessionInfo } from "../../api";
import type { NavigateInput, NavigateLevel } from "../../navigateModel";

const session = (id: string, cwd: string, name?: string): SessionInfo => ({
  id,
  path: `/store/${id}.jsonl`,
  cwd,
  persisted: true,
  created: "2026-09-01T00:00:00.000Z",
  modified: "2026-09-01T00:00:00.000Z",
  messageCount: 2,
  firstMessage: "",
  ...(name === undefined ? {} : { name }),
});

function input(patch: Partial<Omit<NavigateInput, "query">> = {}): Omit<NavigateInput, "query"> {
  return {
    scope: { machineId: "local", projectId: undefined, folderPath: undefined, sessionId: undefined },
    machines: [{ id: "local", name: "Local" }],
    projects: [{ id: "p1", name: "pi-web", path: "/repos/pi-web" }],
    folders: [{ id: "w1", label: "main", path: "/repos/pi-web", projectId: "p1" }],
    sessions: [session("a", "/repos/pi-web", "fix login")],
    pinned: [],
    waitingSessionIds: new Set(),
    activeSessionIds: new Set(),
    pinnedSessionIds: new Set(),
    ...patch,
  };
}

async function mount(patch: Partial<AppNavigatePage> = {}, modelInput = input()): Promise<AppNavigatePage> {
  const page = document.createElement("app-navigate-page");
  page.input = modelInput;
  // The page opens on the machine's whole list, which the host supplies
  // separately; tests that care about a narrowed path set it themselves.
  page.machineSessions = modelInput.sessions;
  Object.assign(page, patch);
  document.body.append(page);
  await page.updateComplete;
  return page;
}

const texts = (page: AppNavigatePage, selector: string) =>
  [...page.renderRoot.querySelectorAll<HTMLElement>(selector)].map((node) => node.textContent.trim());

describe("app-navigate-page", () => {
  it("says it is reading rather than claiming an empty machine", async () => {
    const page = document.createElement("app-navigate-page");
    document.body.append(page);
    await page.updateComplete;
    expect(page.renderRoot.textContent).toContain("Reading this machine");
  });

  it("shows the path, the sessions in scope and the level below", async () => {
    const page = await mount();
    expect(texts(page, ".path-step")).toEqual(["All projects"]);
    expect(texts(page, ".row.session").join(" ")).toContain("fix login");
    expect(texts(page, ".section-title")).toEqual(["Recent"]);
    expect(texts(page, ".kind")).toEqual(["Sessions", "Projects"]);
  });

  it("narrows through a choice without leaving the page", async () => {
    const onChoose = vi.fn<(level: NavigateLevel, id: string) => void>();
    const page = await mount({ onChoose });
    [...page.renderRoot.querySelectorAll<HTMLButtonElement>(".kind")].find((tab) => tab.textContent.includes("Projects"))?.click();
    await page.updateComplete;
    const project = [...page.renderRoot.querySelectorAll<HTMLButtonElement>(".row:not(.session)")].find((row) => row.textContent.includes("pi-web"));
    project?.click();
    expect(onChoose).toHaveBeenCalledWith("project", "p1");
  });

  it("widens by tapping the level on the path", async () => {
    const onWiden = vi.fn<(level: NavigateLevel) => void>();
    const page = await mount({ onWiden });
    page.renderRoot.querySelector<HTMLButtonElement>(".path-step")?.click();
    expect(onWiden).toHaveBeenCalledWith("project");
  });

  it("opens a session with the machine it belongs to", async () => {
    const onOpenSession = vi.fn<(session: SessionInfo, machineId: string) => void>();
    const page = await mount({ onOpenSession }, input({ pinned: [{ session: session("z", "/elsewhere", "remote"), machineId: "pi" }] }));
    const pinned = [...page.renderRoot.querySelectorAll<HTMLButtonElement>(".row.session")].find((row) => row.textContent.includes("remote"));
    pinned?.click();
    expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining({ id: "z" }), "pi");
  });

  it("lists a session by name with the project it runs in under it", async () => {
    const page = await mount({}, input({ waitingSessionIds: new Set(["a"]) }));
    expect(texts(page, ".row.session .row-name")).toEqual(["fix login"]);
    expect(texts(page, ".row.session .row-path")).toEqual(["pi-web"]);
  });

  it("offers only the levels a reader can stand on", async () => {
    const page = await mount({}, input({ scope: { machineId: "local", projectId: "p1", folderPath: undefined, sessionId: undefined } }));
    expect(texts(page, ".kind")).toEqual(["Sessions", "Projects"]);
  });

  it("marks the open session in the list", async () => {
    const page = await mount({}, input({ scope: { machineId: "local", projectId: undefined, folderPath: undefined, sessionId: "a" } }));
    const current = page.renderRoot.querySelector(".row.session.current");
    expect(current?.getAttribute("aria-current")).toBe("true");
  });

  it("filters by tag from the search field", async () => {
    const page = await mount({}, input({ waitingSessionIds: new Set(["a"]) }));
    const search = page.renderRoot.querySelector<HTMLInputElement>(".search");
    if (search === null) throw new Error("no search field");
    search.value = "#waiting";
    search.dispatchEvent(new Event("input"));
    await page.updateComplete;
    expect(texts(page, ".section-title")).toContain("Waiting for you");

    search.value = "#nothing";
    search.dispatchEvent(new Event("input"));
    await page.updateComplete;
    expect(page.renderRoot.textContent).toContain("No sessions match");
  });

  it("offers a close only when a session is open behind it", async () => {
    const withSession = await mount({ closable: true });
    expect(withSession.renderRoot.querySelector(".close")).not.toBeNull();
    const standalone = await mount();
    expect(standalone.renderRoot.querySelector(".close")).toBeNull();
  });

  it("gives every row one name on the left and one menu on the right, with no second line", async () => {
    const page = await mount();
    page.showKind("project");
    await page.updateComplete;
    const row = page.renderRoot.querySelector(".row-wrap");
    expect(row).not.toBeNull();
    expect(row?.querySelector(".row-detail")).toBeNull();
    const menu = row?.querySelector(".action-menu-toggle");
    expect(menu?.getAttribute("aria-haspopup")).toBe("menu");
    expect(menu?.getAttribute("aria-expanded")).toBe("false");
  });

  it("reports the action the reader picked against that row, not the current selection", async () => {
    const picked: string[] = [];
    const page = await mount();
    page.canCloseProject = true;
    page.onRowAction = (kind, id, action) => { picked.push(`${kind}:${id}:${action}`); };
    page.showKind("project");
    await page.updateComplete;
    const toggle = page.renderRoot.querySelector<HTMLButtonElement>(".action-menu-toggle");
    toggle?.click();
    await page.updateComplete;
    const items = [...page.renderRoot.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent.trim())).toContain("Close project");
    items.find((item) => item.textContent.trim() === "Close project")?.click();
    await page.updateComplete;
    expect(picked).toHaveLength(1);
    expect(picked[0] ?? "").toMatch(/^project:.*:close-project$/u);
  });

  it("says it is reading rather than claiming the scope is empty", async () => {
    const page = await mount({ loadingSessions: true }, { ...input(), sessions: [] });
    expect(page.renderRoot.textContent).toContain("Loading sessions…");
    expect(page.renderRoot.textContent).not.toContain("No sessions");
  });

  it("names a failed read instead of an empty list", async () => {
    const page = await mount({ loadError: "Couldn't read the sessions here." }, { ...input(), sessions: [] });
    expect(page.renderRoot.textContent).toContain("Couldn't read the sessions here.");
  });

  it("says it is reading while the choices for a kind are unknown", async () => {
    const page = await mount({ loadingChoices: true }, { ...input(), projects: [], machines: [] });
    page.showKind("project");
    await page.updateComplete;
    expect(page.renderRoot.textContent).toContain("Loading…");
    expect(page.renderRoot.textContent).not.toContain("Nothing to choose");
  });
});

describe("the quick-access key", () => {
  it("widens to everything first and closes the page when there is nothing left to widen", async () => {
    const closes: number[] = [];
    const page = await mount({ closable: true, returnable: true, onClose: () => { closes.push(1); } });
    Reflect.set(page, "kind", "project");
    await page.updateComplete;

    page.renderRoot.querySelector<HTMLButtonElement>(".quick-access")?.click();
    await page.updateComplete;

    expect(Reflect.get(page, "kind")).toBe("sessions");
    expect(closes).toHaveLength(0);

    page.renderRoot.querySelector<HTMLButtonElement>(".quick-access")?.click();

    expect(closes).toHaveLength(1);
    page.remove();
  });
});

describe("the quick-access key with nowhere to return to", () => {
  it("only widens on the desktop rail, which is the page's permanent home", async () => {
    const closes: number[] = [];
    const page = await mount({ closable: false, returnable: false, onClose: () => { closes.push(1); } });

    page.renderRoot.querySelector<HTMLButtonElement>(".quick-access")?.click();
    await page.updateComplete;
    page.renderRoot.querySelector<HTMLButtonElement>(".quick-access")?.click();

    expect(closes).toHaveLength(0);
    expect(page.renderRoot.querySelector(".quick-access")?.getAttribute("aria-label")).toBe("All sessions on this machine");
    page.remove();
  });
});

/**
 * Owner's call: a static green pip could not be told from the idle grey one.
 * Work in progress is the shared bouncing dots the transcript already uses.
 */
describe("the working mark", () => {
  it("animates three dots for a session that is working", async () => {
    const working = session("busy", "/repos/pi-web", "running now");
    const page = await mount({}, input({
      sessions: [working],
      activeSessionIds: new Set(["busy"]),
    }));

    const running = page.renderRoot.querySelector(".session-state.running");

    expect(running).not.toBeNull();
    expect(running?.querySelectorAll(".state-dot").length).toBe(3);
    expect(running?.getAttribute("aria-label")).toBe("Working");
    expect(page.renderRoot.querySelector(".state.working")).toBeNull();
  });

  it("keeps a still dot for idle and waiting", async () => {
    const page = await mount({}, input({
      sessions: [session("idle-one", "/repos/pi-web", "done"), session("asked", "/repos/pi-web", "asking")],
      waitingSessionIds: new Set(["asked"]),
    }));

    expect(page.renderRoot.querySelector(".state.idle")).not.toBeNull();
    expect(page.renderRoot.querySelector(".state.waiting")).not.toBeNull();
    expect(page.renderRoot.querySelector(".session-state.running")).toBeNull();
  });
});
