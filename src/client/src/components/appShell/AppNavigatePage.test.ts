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

  it("lists a session by name alone", async () => {
    const page = await mount({}, input({ waitingSessionIds: new Set(["a"]) }));
    expect(texts(page, ".row.session")).toEqual(["fix login"]);
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
});
