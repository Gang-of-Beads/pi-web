import { expect, test, type Page } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";

/**
 * Mobile shell behaviour on a phone viewport.
 *
 * The app renders through nested shadow roots, so structural assertions dig
 * with `evaluate` rather than CSS selectors, which do not pierce shadow DOM.
 */

test.describe("mobile shell", () => {
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport behaviour");

  test("shows the context bar and one primary list rather than a stack of sections", async ({ page }) => {
    await openApp(page);

    const shell = await page.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      const root = app?.shadowRoot;
      if (root === undefined || root === null) return undefined;
      const panel = root.querySelector("app-navigation-panel");
      const panelRoot = panel?.shadowRoot;
      const visibleSections = panelRoot === undefined || panelRoot === null
        ? []
        : [...panelRoot.querySelectorAll("machine-list, project-list, workspace-list, session-list")]
          .filter((element) => !element.hasAttribute("hidden"))
          .map((element) => element.tagName.toLowerCase());
      return {
        hasContextBar: root.querySelector("app-context-bar") !== null,
        visibleSections,
      };
    });

    expect(shell?.hasContextBar).toBe(true);
    // The accordion regression this guards against is every section rendering
    // at once, forcing the user to scroll past collapsed headers.
    expect(shell?.visibleSections.length).toBeLessThanOrEqual(1);
  });

  test("keeps the chat surface taller than the chrome above it", async ({ page }) => {
    await openApp(page);

    const layout = await page.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      const root = app?.shadowRoot;
      if (root === undefined || root === null) return undefined;
      const bar = root.querySelector("app-context-bar");
      const tabs = root.querySelector("app-mobile-main-tabs");
      const height = (element: Element | null) => element === null ? 0 : element.getBoundingClientRect().height;
      return {
        chromeHeight: height(bar) + height(tabs),
        viewportHeight: window.innerHeight,
      };
    });

    expect(layout).toBeDefined();
    // Chrome is allowed to exist, but not to eat a third of a phone screen.
    expect(layout!.chromeHeight).toBeLessThan(layout!.viewportHeight / 3);
  });
});

test.describe("goal panel", () => {
  test.skip(({ isMobile }) => isMobile === false, "runs once, on the mobile projection");

  test("renders goal progress read from the workspace", async ({ page, request }) => {
    const stamp = String(Date.now());
    const name = `e2e-goals-${stamp}`;
    const path = `/data/home/${name}`;

    const created = await request.post(`${apiBaseURL}/api/projects`, { data: { name, path, create: true } });
    expect(created.ok()).toBe(true);
    const { id: projectId } = await created.json() as { id: string };

    const workspaces = await request.get(`${apiBaseURL}/api/projects/${projectId}/workspaces`);
    const { workspaces: list } = await workspaces.json() as { workspaces: { id: string }[] };
    const workspaceId = list[0]?.id ?? "";

    // The goal file is written by the extension in real use; the API is the
    // contract this panel depends on, so assert it before the UI.
    await writeGoalFixture(path);
    const goals = await request.get(`${apiBaseURL}/api/projects/${projectId}/workspaces/${workspaceId}/goals`);
    const body = await goals.json() as { goals: { id: string; completedTaskCount: number; totalTaskCount: number }[] };

    expect(body.goals).toHaveLength(1);
    // Nested subtasks count towards the ratio, so 2 of 3 rather than 1 of 2.
    expect(body.goals[0]).toMatchObject({ id: "e2e-goal", completedTaskCount: 2, totalTaskCount: 3 });

    await openApp(page);
    await selectProject(page, name);

    const panel = await page.evaluate(async () => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const root = document.querySelector("pi-web-app")?.shadowRoot;
        const goalPanel = root?.querySelector("app-navigation-panel")?.shadowRoot?.querySelector("goal-panel");
        const goalRoot = goalPanel?.shadowRoot;
        if (goalRoot != null && goalRoot.querySelector(".goal") !== null) {
          const bar = goalRoot.querySelector('[role="progressbar"]');
          return {
            text: goalRoot.textContent?.replace(/\s+/gu, " ").trim() ?? "",
            valueNow: bar?.getAttribute("aria-valuenow") ?? "",
            valueMax: bar?.getAttribute("aria-valuemax") ?? "",
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return undefined;
    });

    expect(panel, "goal panel should render for a workspace with goals").toBeDefined();
    expect(panel!.text).toContain("Verify the goal panel end to end");
    expect(panel!.text).toContain("2/3");
    expect(panel!.valueNow).toBe("2");
    expect(panel!.valueMax).toBe("3");
  });
});

async function openApp(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("pi-web-app")).toBeAttached();
  await page.waitForFunction(() => document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-navigation-panel") !== null);
}

/**
 * Select a project, then its workspace.
 *
 * Playwright's role selectors do not pierce shadow DOM and the rows are
 * several roots deep, so clicks are dispatched in-page. The row's primary
 * region is the target: the only <button> in a row is the `⋯` actions menu,
 * and clicking that opens a menu instead of selecting.
 */
async function selectProject(page: Page, projectName: string): Promise<void> {
  await clickRow(page, "project-list", projectName);
  // A project with a single folder workspace still requires selecting it before
  // workspace-scoped context such as goals is loaded.
  await clickRow(page, "workspace-list", projectName);
}

async function clickRow(page: Page, listTag: string, text: string): Promise<void> {
  const clicked = await page.evaluate(async ({ tag, needle }) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const panel = document.querySelector("pi-web-app")?.shadowRoot
        ?.querySelector("app-navigation-panel")?.shadowRoot;
      const list = panel?.querySelector(tag)?.shadowRoot;
      const row = [...(list?.querySelectorAll(".action-row") ?? [])]
        .find((candidate) => candidate.textContent?.includes(needle));
      const target = row?.querySelector(".action-main") ?? row;
      if (target instanceof HTMLElement) { target.click(); return true; }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  }, { tag: listTag, needle: text });
  expect(clicked, `${listTag} row containing "${text}" should be clickable`).toBe(true);
}

/**
 * Write a goal record into the container using the same layout `pi-goal-x`
 * produces: a leading JSON block followed by its Markdown rendering.
 */
async function writeGoalFixture(workspacePath: string): Promise<void> {
  const record = {
    version: 3,
    id: "e2e-goal",
    objective: "Verify the goal panel end to end",
    status: "active",
    autoContinue: true,
    sisyphus: false,
    usage: { tokensUsed: 24_000, activeSeconds: 12 },
    createdAt: "2026-08-15T19:18:35.628Z",
    updatedAt: "2026-08-15T19:19:47.890Z",
    currentTaskId: "task-2",
    taskList: {
      tasks: [
        { id: "task-1", title: "Parse the record", status: "complete", verificationContract: "Leading JSON parses" },
        {
          id: "task-2",
          title: "Render the panel",
          status: "pending",
          subtasks: [{ id: "task-2a", title: "Progress bar", status: "complete" }],
        },
      ],
    },
  };
  const contents = `${JSON.stringify(record, null, 2)}\n\n# Goal Prompt\n\n${record.objective}\n`;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  await run("docker", [
    "exec", "pi-web-fork-verify-web-1",
    "bash", "-lc",
    `mkdir -p ${workspacePath}/.pi/goals && cat > ${workspacePath}/.pi/goals/active_goal_e2e.md <<'GOALEOF'\n${contents}GOALEOF`,
  ]);
}
