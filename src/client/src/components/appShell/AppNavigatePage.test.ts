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

/** Click an element the test depends on, failing loudly when it is missing rather than passing a negative half on nothing. */
function press(element: HTMLElement | null | undefined): void {
  if (element === null || element === undefined) throw new Error("the element to press is not on the page");
  element.click();
}

async function mount(patch: Partial<AppNavigatePage> = {}, modelInput = input()): Promise<AppNavigatePage> {
  const page = document.createElement("app-navigate-page");
  page.input = modelInput;
  // The page opens on the machine's whole list, which the host supplies
  // separately; tests that care about a narrowed path set it themselves.
  page.machineSessions = modelInput.sessions;
  page.boardAnswer = "complete";
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

  it("widens by tapping the level on the path above a project stepped into", async () => {
    const onWiden = vi.fn<(level: NavigateLevel) => void>();
    const page = await mount({ onWiden });
    Reflect.set(page, "pathProjectId", "p1");
    await page.updateComplete;
    press(page.renderRoot.querySelector<HTMLButtonElement>(".path-step"));
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

  it("has no close key of its own: the grid key is the way back (owner, 2026-09-30)", async () => {
    const overlay = await mount({ returnable: true });
    expect({ close: overlay.renderRoot.querySelector(".close"), grid: overlay.renderRoot.querySelector(".quick-access")?.getAttribute("aria-label") })
      .toEqual({ close: null, grid: "Close navigation" });
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

  it("closes the row menu on a second tap of its key, instead of closing and reopening it", async () => {
    const page = await mount();
    const toggle = page.renderRoot.querySelector<HTMLButtonElement>(".action-menu-toggle");
    press(toggle);
    await page.updateComplete;
    const scrim = page.renderRoot.querySelector<HTMLElement>(".menu-scrim");
    if (scrim === null) throw new Error("the open menu has no scrim");
    scrim.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    await page.updateComplete;
    expect(page.renderRoot.querySelector(".action-menu-panel")).not.toBeNull();
    scrim.click();
    await page.updateComplete;
    expect(page.renderRoot.querySelector(".action-menu-panel")).toBeNull();
  });

  it("keeps archived sessions in a collapsed group at the bottom that opens on a tap", async () => {
    const old = { ...session("z", "/repos/pi-web", "old spike"), archived: true };
    const page = await mount({}, input({ sessions: [session("a", "/repos/pi-web", "fix login"), old] }));
    const group = page.renderRoot.querySelector<HTMLButtonElement>(".archived-toggle");
    expect(group?.textContent.trim()).toBe("Archived (1)");
    expect(group?.getAttribute("aria-expanded")).toBe("false");
    expect(texts(page, ".row.session .row-name")).toEqual(["fix login"]);
    press(group);
    await page.updateComplete;
    expect(texts(page, ".row.session .row-name")).toEqual(["fix login", "old spike"]);
  });

  it("offers Archive on a live session and Restore / Delete permanently on an archived one", async () => {
    const old = { ...session("z", "/repos/pi-web", "old spike"), archived: true };
    const page = await mount({ canArchiveSessions: true }, input({ sessions: [session("a", "/repos/pi-web", "fix login"), old] }));
    press(page.renderRoot.querySelector<HTMLButtonElement>(".archived-toggle"));
    await page.updateComplete;
    const menuOf = async (name: string) => {
      const wrap = [...page.renderRoot.querySelectorAll<HTMLElement>(".row-wrap")].find((row) => row.textContent.includes(name));
      press(wrap?.querySelector<HTMLButtonElement>(".action-menu-toggle"));
      await page.updateComplete;
      const items = texts(page, '[role="menuitem"]');
      press(page.renderRoot.querySelector<HTMLElement>(".menu-scrim"));
      await page.updateComplete;
      return items;
    };
    expect(await menuOf("fix login")).toContain("Archive");
    expect(await menuOf("old spike")).toEqual(["Open", "Restore", "Delete permanently"]);
  });

  /**
   * B48, found live on 8505: with the projects read answering 500, the board
   * said "No sessions yet." for a machine that has sessions. The board claims
   * emptiness only once every source answered, and never says it is reading.
   */
  it("claims nothing about an empty board until every source answered", async () => {
    const said: Record<string, { reading: boolean; empty: boolean }> = {};
    for (const boardAnswer of ["none", "partial", "complete"] as const) {
      const page = await mount({ boardAnswer }, { ...input(), sessions: [] });
      const text = page.renderRoot.textContent;
      said[boardAnswer] = { reading: text.includes("Loading sessions"), empty: text.includes("No sessions yet") };
      page.remove();
    }
    expect(said).toEqual({ none: { reading: false, empty: false }, partial: { reading: false, empty: false }, complete: { reading: false, empty: true } });
  });

  it("says nothing while the choices for a kind have not answered: no reading text, no empty claim, no failure (B48)", async () => {
    const page = await mount({ loadingChoices: true }, { ...input(), projects: [], machines: [] });
    page.showKind("project");
    await page.updateComplete;
    const text = page.renderRoot.textContent;
    expect({ loading: text.includes("Loading…"), empty: text.includes("Nothing to choose"), failed: text.includes("Couldn't") }).toEqual({ loading: false, empty: false, failed: false });
  });
});

describe("the quick-access key over an open session", () => {
  it("returns from a Projects tab without touching the selection, and widens through the app only from a project stepped into", async () => {
    const widened: string[] = [];
    const closes: number[] = [];
    const page = await mount({ returnable: true, onClose: () => { closes.push(1); }, onWiden: (level: string) => { widened.push(level); } });
    Reflect.set(page, "kind", "project");
    await page.updateComplete;
    press(page.renderRoot.querySelector<HTMLButtonElement>(".quick-access"));
    await page.updateComplete;
    press(page.renderRoot.querySelector<HTMLButtonElement>(".quick-access"));
    const fromTab = { widened: [...widened], closes: closes.length };
    Reflect.set(page, "pathProjectId", "project-1");
    await page.updateComplete;
    press(page.renderRoot.querySelector<HTMLButtonElement>(".quick-access"));

    expect({ fromTab, fromProject: widened }).toEqual({ fromTab: { widened: [], closes: 1 }, fromProject: ["project"] });
    page.remove();
  });
});

describe("the path steps over an open session", () => {
  it("widen through the app only from a project stepped into, and the empty list speaks for the page's own scope", async () => {
    const widened: string[] = [];
    const page = await mount({ returnable: true, onWiden: (level: string) => { widened.push(level); } });
    const projectStep = (): HTMLButtonElement | undefined => [...page.renderRoot.querySelectorAll<HTMLButtonElement>(".path-step")].at(-1);
    press(projectStep());
    await page.updateComplete;
    const onTheMachine = [...widened];
    Reflect.set(page, "pathProjectId", "project-1");
    await page.updateComplete;
    press(projectStep());

    expect({ onTheMachine, fromAProject: widened }).toEqual({ onTheMachine: [], fromAProject: ["project"] });
    page.remove();
  });

  it("says the machine has no sessions, not a narrower part of the path, when it lists the machine", async () => {
    const machineWide = input();
    const page = await mount({ machineSessions: [] }, { ...machineWide, scope: { ...machineWide.scope, projectId: "p1" }, sessions: [] });
    page.machineSessions = [];
    await page.updateComplete;

    expect(page.renderRoot.textContent).toContain("No sessions yet.");
    page.remove();
  });
});

describe("the quick-access key", () => {
  it("widens to everything first and closes the page when there is nothing left to widen", async () => {
    const closes: number[] = [];
    const page = await mount({ returnable: true, onClose: () => { closes.push(1); } });
    Reflect.set(page, "kind", "project");
    await page.updateComplete;

    press(page.renderRoot.querySelector<HTMLButtonElement>(".quick-access"));
    await page.updateComplete;

    expect(Reflect.get(page, "kind")).toBe("sessions");
    expect(closes).toHaveLength(0);

    press(page.renderRoot.querySelector<HTMLButtonElement>(".quick-access"));

    expect(closes).toHaveLength(1);
    page.remove();
  });
});

describe("the quick-access key with nowhere to return to", () => {
  it("only widens on the desktop rail, which is the page's permanent home", async () => {
    const closes: number[] = [];
    const page = await mount({ returnable: false, onClose: () => { closes.push(1); } });

    press(page.renderRoot.querySelector<HTMLButtonElement>(".quick-access"));
    await page.updateComplete;
    press(page.renderRoot.querySelector<HTMLButtonElement>(".quick-access"));

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
