import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";
import { CONTAINER_HOME, createProject, firstWorkspace, type WorkspaceRef } from "./fixtures";

/**
 * How the navigation panel spends its height.
 *
 * Every expanded section used to share the panel equally, so a workspace with
 * dozens of sessions showed a single session row beside a one-machine list -
 * the list you work in was the one squeezed. Sessions are the working surface:
 * the pickers above are chosen once and read at a glance, so they size to their
 * content and sessions take the rest.
 *
 * Geometry is measured in the browser rather than inferred from CSS, because
 * the regression that shipped was exactly a rule that looked right in review.
 */

const SESSION_COUNT = 12;

test.describe("navigation panel height", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(({ isMobile }) => isMobile === true, "desktop panel allocation");

  test("gives the session list more room than the pickers above it", async ({ page }) => {
    const workspace = await seededWorkspace(page.request);
    await openWorkspace(page, workspace);

    const sections = await sectionGeometry(page);
    const sessions = sections.find((section) => section.tag === "session-list");
    const pickers = sections.filter((section) => section.tag !== "session-list" && section.tag !== "goal-panel");

    expect(sessions, "the session list must be rendered").toBeDefined();
    expect(sessions!.height).toBeGreaterThan(300);
    for (const picker of pickers) {
      expect(picker.height, `${picker.tag} must not out-size the session list`).toBeLessThan(sessions!.height);
    }
    // The session rows must actually be reachable: several visible at once, not
    // one row peeking out of a strip.
    expect(await visibleSessionRows(page)).toBeGreaterThan(3);
  });

  test("keeps a picker out of the body until it is being used", async ({ page }) => {
    // Superseded contract: pickers used to be capped at 30vh while stacked
    // above the session list. They are no longer stacked at all - the context
    // row names them, and only the section being changed occupies the body.
    const workspace = await seededWorkspace(page.request);
    await openWorkspace(page, workspace);

    const sections = await sectionGeometry(page);
    expect(sections.map((section) => section.tag)).toEqual(["session-list"]);
  });
});

test.describe("tile row menu", () => {
  test("draws the tile's menu button as a closed control, not an open-sided one", async ({ page }) => {
    // In a list row the menu toggle drops its left border on purpose: the
    // primary region sits against it and draws the divider. Tiles float the
    // same button in the corner with nothing beside it, where that rule left
    // one side of the button missing.
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const list = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-navigation-panel")?.shadowRoot?.querySelector("project-list")?.shadowRoot;
      return (list?.querySelectorAll(".list-body.tiles .action-menu-toggle").length ?? 0) > 0;
    }, undefined, { timeout: 20_000 });

    const measured = await page.evaluate(() => {
      const list = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-navigation-panel")?.shadowRoot?.querySelector("project-list")?.shadowRoot;
      const toggle = list?.querySelector(".list-body.tiles .action-menu-toggle");
      if (toggle === null || toggle === undefined) return undefined;
      const style = getComputedStyle(toggle);
      const box = toggle.getBoundingClientRect();
      return {
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        radius: [style.borderTopLeftRadius, style.borderBottomLeftRadius],
        size: { width: Math.round(box.width), height: Math.round(box.height) },
      };
    });

    expect(measured?.borders).toEqual(["1px", "1px", "1px", "1px"]);
    expect(measured?.radius).toEqual(["8px", "8px"]);
    expect(measured?.size.width).toBeGreaterThanOrEqual(32);
    expect(measured?.size.height).toBeGreaterThanOrEqual(32);
  });
});

interface SectionBox { tag: string; height: number; top: number }

async function sectionGeometry(page: Page): Promise<SectionBox[]> {
  return await page.evaluate(() => {
    const panel = document.querySelector("pi-web-app")?.shadowRoot
      ?.querySelector("app-navigation-panel")?.shadowRoot;
    return [...(panel?.querySelectorAll("machine-list, project-list, workspace-list, session-list, goal-panel") ?? [])]
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { tag: element.tagName.toLowerCase(), height: Math.round(box.height), top: Math.round(box.top) };
      })
      .filter((section) => section.height > 0);
  });
}

async function visibleSessionRows(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const list = document.querySelector("pi-web-app")?.shadowRoot
      ?.querySelector("app-navigation-panel")?.shadowRoot
      ?.querySelector("session-list")?.shadowRoot;
    const body = list?.querySelector(".list-body");
    if (body === null || body === undefined) return 0;
    const bounds = body.getBoundingClientRect();
    return [...list.querySelectorAll(".action-row")]
      .filter((row) => {
        const box = row.getBoundingClientRect();
        return box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
      }).length;
  });
}

async function openWorkspace(page: Page, workspace: WorkspaceRef): Promise<void> {
  await page.goto(`/?project=${workspace.projectId}&workspace=${workspace.workspaceId}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const panel = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-navigation-panel")?.shadowRoot;
    return (panel?.querySelector("session-list")?.shadowRoot?.querySelectorAll(".action-row").length ?? 0) > 3;
  }, undefined, { timeout: 60_000 });
}

/**
 * A workspace with enough sessions to expose the allocation.
 *
 * Sessions are listed only once they have a transcript on disk, so each one is
 * seeded with a FASTMOCK prompt the mock provider answers in a single chunk.
 * The fixture is reused across runs instead of re-seeded every time.
 */
async function seededWorkspace(request: APIRequestContext): Promise<WorkspaceRef> {
  const name = "e2e-fixture-layout";
  const projectId = await createProject(request, name, `${CONTAINER_HOME}/${name}`);
  const workspace = await firstWorkspace(request, projectId);

  const existing = await listSessions(request, workspace.path);
  for (let index = existing.length; index < SESSION_COUNT; index++) {
    const created = await request.post(`${apiBaseURL}/api/machines/local/sessions`, { data: { cwd: workspace.path } });
    expect(created.ok()).toBe(true);
    const session = await created.json() as { id: string };
    await request.post(`${apiBaseURL}/api/machines/local/sessions/${session.id}/model`, { data: { cwd: workspace.path, provider: "mock", modelId: "mock-model" } });
    await request.post(`${apiBaseURL}/api/machines/local/sessions/${session.id}/prompt`, { data: { cwd: workspace.path, text: `FASTMOCK seed ${String(index + 1)}` } });
  }
  await expect.poll(async () => (await listSessions(request, workspace.path)).length, { timeout: 60_000, message: "seeded sessions must be listed" })
    .toBeGreaterThanOrEqual(SESSION_COUNT);
  return workspace;
}

async function listSessions(request: APIRequestContext, cwd: string): Promise<{ id: string; archived?: boolean }[]> {
  const response = await request.get(`${apiBaseURL}/api/machines/local/sessions?cwd=${encodeURIComponent(cwd)}`);
  expect(response.ok()).toBe(true);
  const sessions = await response.json() as { id: string; archived?: boolean }[];
  return sessions.filter((session) => session.archived !== true);
}

test.describe("context row", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(({ isMobile }) => isMobile === true, "desktop panel");

  test("names the context in one row and gives the body to the sessions", async ({ page }) => {
    const workspace = await seededWorkspace(page.request);
    await openWorkspace(page, workspace);

    const measured = await page.evaluate(() => {
      const panel = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-navigation-panel")?.shadowRoot;
      const row = panel?.querySelector("app-context-switcher");
      const chips = [...(row?.shadowRoot?.querySelectorAll(".chip") ?? [])].map((chip) => chip.textContent?.replace(/\s+/g, " ").trim() ?? "");
      const sections = [...(panel?.querySelectorAll("machine-list, project-list, workspace-list, session-list") ?? [])]
        .map((element) => ({ tag: element.tagName.toLowerCase(), height: Math.round(element.getBoundingClientRect().height) }))
        .filter((section) => section.height > 0);
      const adds = [...(row?.shadowRoot?.querySelectorAll(".add") ?? [])].map((button) => button.getAttribute("aria-label") ?? "");
      return { chips, sections, adds };
    });

    // The row names project and workspace; the machine step only appears with a
    // second machine to switch to.
    expect(measured.chips.some((chip) => chip.startsWith("Project"))).toBe(true);
    expect(measured.chips.some((chip) => chip.startsWith("Workspace"))).toBe(true);
    // Exactly one section owns the body, and with a workspace chosen it is the
    // session list rather than a picker.
    expect(measured.sections).toHaveLength(1);
    expect(measured.sections[0]?.tag).toBe("session-list");
    expect(measured.sections[0]?.height).toBeGreaterThan(400);
    // Creating is inline, not palette-only.
    expect(measured.adds).toContain("Add project");
  });

  test("opens a picker from its chip and returns the body to sessions on pick", async ({ page }) => {
    const workspace = await seededWorkspace(page.request);
    await openWorkspace(page, workspace);

    const openPicker = async () => await page.evaluate(() => {
      const panel = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-navigation-panel")?.shadowRoot;
      const chip = [...(panel?.querySelector("app-context-switcher")?.shadowRoot?.querySelectorAll<HTMLElement>(".chip") ?? [])]
        .find((candidate) => candidate.textContent?.includes("Project") === true);
      chip?.click();
      return chip !== undefined;
    });
    expect(await openPicker()).toBe(true);
    await page.waitForFunction(() => {
      const panel = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-navigation-panel")?.shadowRoot;
      return (panel?.querySelector("project-list")?.getBoundingClientRect().height ?? 0) > 200;
    }, undefined, { timeout: 10_000 });

    const visible = await page.evaluate(() => [...(document.querySelector("pi-web-app")?.shadowRoot
      ?.querySelector("app-navigation-panel")?.shadowRoot
      ?.querySelectorAll("machine-list, project-list, workspace-list, session-list") ?? [])]
      .filter((element) => element.getBoundingClientRect().height > 0)
      .map((element) => element.tagName.toLowerCase()));
    expect(visible).toEqual(["project-list"]);
  });
});

/**
 * One create control per viewport.
 *
 * The Projects heading carries a "+" so a phone can add a project without a
 * bar of its own. The desktop layout already has a context switcher whose
 * Project step carries the same control, and stacking both is the clutter that
 * switcher was built to remove - it replaced three frames and two plus-buttons
 * that "made the row read as five controls".
 */
test.describe("project create affordance", () => {
  test.skip(({ isMobile }) => isMobile === true, "desktop panel composition");

  test("does not repeat Add project beside the switcher that already offers it", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("pi-web-app")).toBeAttached();
    await page.waitForFunction(() => document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-navigation-panel") !== null);

    const measured = await page.evaluate(() => {
      const panelRoot = document.querySelector("pi-web-app")?.shadowRoot
        ?.querySelector("app-navigation-panel")?.shadowRoot;
      const switcherRoot = panelRoot?.querySelector("app-context-switcher")?.shadowRoot;
      const listRoot = panelRoot?.querySelector("project-list")?.shadowRoot;
      return {
        switcherAdds: [...(switcherRoot?.querySelectorAll(".add") ?? [])]
          .map((node) => node.getAttribute("aria-label") ?? node.getAttribute("title") ?? ""),
        headingAdd: listRoot?.querySelector(".section-add") !== null
          && listRoot?.querySelector(".section-add") !== undefined,
      };
    });

    expect(measured.switcherAdds.some((label) => /add project/i.test(label)), "the switcher owns the control here").toBe(true);
    expect(measured.headingAdd, "so the heading must not add a second one").toBe(false);
  });
});
