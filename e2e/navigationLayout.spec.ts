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

  test("keeps the pickers within their cap when they have plenty of content", async ({ page }) => {
    const workspace = await seededWorkspace(page.request);
    await openWorkspace(page, workspace);

    const viewport = page.viewportSize();
    const sections = await sectionGeometry(page);
    const projects = sections.find((section) => section.tag === "project-list");

    expect(projects).toBeDefined();
    // 30vh cap: a long project list scrolls internally instead of pushing the
    // session list off the panel.
    expect(projects!.height).toBeLessThanOrEqual(Math.round((viewport?.height ?? 900) * 0.31));
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
