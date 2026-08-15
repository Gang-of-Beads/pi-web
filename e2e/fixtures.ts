import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Helpers for driving the isolated Docker instance through its own HTTP API.
 *
 * Fixtures are created over the API rather than through the UI so a test that
 * is about (say) the goal panel does not fail because project creation changed.
 */

export interface WorkspaceRef {
  projectId: string;
  workspaceId: string;
  path: string;
}

/** Container path that is writable and outside the mounted repo checkout. */
export const CONTAINER_HOME = "/data/home";

export async function createProject(request: APIRequestContext, name: string, path: string): Promise<string> {
  const response = await request.post("/api/projects", { data: { name, path, create: true } });
  expect(response.ok(), `create project ${name}: ${String(response.status())}`).toBe(true);
  const project = await response.json() as { id: string };
  return project.id;
}

export async function firstWorkspace(request: APIRequestContext, projectId: string): Promise<WorkspaceRef> {
  const response = await request.get(`/api/projects/${projectId}/workspaces`);
  expect(response.ok()).toBe(true);
  const body = await response.json() as { workspaces: { id: string; path: string }[] };
  const workspace = body.workspaces[0];
  if (workspace === undefined) throw new Error(`Project ${projectId} has no workspace`);
  return { projectId, workspaceId: workspace.id, path: workspace.path };
}

/**
 * Open the app and select a workspace through the UI.
 *
 * Selection is done by clicking rather than by URL so the test exercises the
 * same navigation a user performs, including the mobile accordion.
 */
export async function openWorkspace(page: Page, projectName: string): Promise<void> {
  await page.goto("/");
  await expect(page.locator("pi-web-app")).toBeVisible();
  const project = page.getByRole("button", { name: new RegExp(projectName, "i") }).first();
  await project.waitFor({ state: "visible" });
  await project.click();
}

/** Deep-query a selector through nested shadow roots, returning a handle. */
export async function shadowText(page: Page, selectors: string[]): Promise<string> {
  return await page.evaluate((path) => {
    let root: Document | ShadowRoot | null = document;
    let element: Element | null = null;
    for (const selector of path) {
      if (root === null) return "";
      element = root.querySelector(selector);
      if (element === null) return "";
      root = element.shadowRoot;
    }
    return element?.textContent?.trim() ?? "";
  }, selectors);
}

/** Whether an element exists at the end of a shadow-root path. */
export async function shadowExists(page: Page, selectors: string[]): Promise<boolean> {
  return await page.evaluate((path) => {
    let root: Document | ShadowRoot | null = document;
    let element: Element | null = null;
    for (const selector of path) {
      if (root === null) return false;
      element = root.querySelector(selector);
      if (element === null) return false;
      root = element.shadowRoot;
    }
    return element !== null;
  }, selectors);
}
