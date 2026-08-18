import { expect, test, type Page } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";

/** Installed into the page by `installSectionGeometry`. */
declare function sectionGeometry(panelRoot: ShadowRoot | null | undefined): { tag: string; height: number; top: number }[];

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
      const panelRoot = root.querySelector("app-navigation-panel")?.shadowRoot;
      return {
        hasContextBar: root.querySelector("app-context-bar") !== null,
        sections: sectionGeometry(panelRoot),
      };
    });

    expect(shell?.hasContextBar).toBe(true);
    // Measured, not inferred from the `hidden` attribute: a host `display` rule
    // beats the UA stylesheet's `[hidden] { display: none }`, so a section can
    // carry the attribute and still occupy a full screen. Asserting the flag
    // rather than the geometry is exactly how that regression shipped.
    expect(shell?.sections.filter((section) => section.height > 0)).toHaveLength(1);
  });

  test("swaps to the workspace list in place after choosing a project", async ({ page }) => {
    // A stable fixture, not a per-run name: the project route is idempotent for
    // an existing path, and a fresh name each run left 127 test projects in the
    // container, which buries the real ones in the navigation list.
    const name = "e2e-fixture-nav";
    await createProjectViaApi(page, name);
    await openApp(page);

    await clickRow(page, "project-list", name);

    const sections = await page.evaluate(() => {
      const panelRoot = document.querySelector("pi-web-app")?.shadowRoot
        ?.querySelector("app-navigation-panel")?.shadowRoot;
      return sectionGeometry(panelRoot);
    });

    const visible = sections.filter((section) => section.height > 0);
    expect(visible.map((section) => section.tag)).toEqual(["workspace-list"]);
    // The reported symptom: the workspace list existed but sat below a full
    // screen of collapsed projects, so it was unreachable without scrolling.
    const workspaces = visible[0];
    expect(workspaces).toBeDefined();
    expect(workspaces!.top).toBeLessThan(400);
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
    const name = "e2e-fixture-goals";
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

/**
 * Geometry of the navigation sections, installed in the page so every test
 * measures visibility the same way.
 */
async function installSectionGeometry(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (globalThis as unknown as Record<string, unknown>)["sectionGeometry"] = (panelRoot: ShadowRoot | null | undefined) => {
      if (panelRoot === null || panelRoot === undefined) return [];
      return [...panelRoot.querySelectorAll("machine-list, project-list, workspace-list, session-list, goal-panel")]
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { tag: element.tagName.toLowerCase(), height: Math.round(box.height), top: Math.round(box.top) };
        });
    };
  });
}

async function createProjectViaApi(page: Page, name: string): Promise<void> {
  const response = await page.request.post(`${apiBaseURL}/api/projects`, {
    data: { name, path: `/data/home/${name}`, create: true },
  });
  expect(response.ok()).toBe(true);
}

async function openApp(page: Page): Promise<void> {
  await installSectionGeometry(page);
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
      // Prefer the row's primary control by role. Lists converted to a real
      // <button> expose one; the rest still fall back to the class, so this
      // helper works across the migration.
      const target = row?.querySelector("button.action-main")
        ?? row?.querySelector(".action-main")
        ?? row;
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

test.describe("composer", () => {
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport behaviour");

  test("keeps the caret one line tall before anything is typed", async ({ page }) => {
    await openApp(page);

    const measured = await page.evaluate(async () => {
      const editor = document.createElement("prompt-editor") as HTMLElement & {
        sessionId?: string;
        cwd?: string;
        updateComplete: Promise<unknown>;
        replaceText: (text: string) => void;
      };
      editor.sessionId = "caret-probe";
      editor.cwd = "/tmp";
      document.body.append(editor);
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 600));

      const root = editor.shadowRoot;
      const lineHeight = () => Math.round(root?.querySelector(".cm-line")?.getBoundingClientRect().height ?? -1);
      const placeholder = root?.querySelector(".cm-placeholder");
      const empty = lineHeight();
      const placeholderVisible = placeholder !== null && placeholder !== undefined
        && placeholder.getBoundingClientRect().height > 0;

      editor.replaceText("typed");
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 300));

      return { empty, typed: lineHeight(), placeholderVisible };
    });

    // The caret is sized from the line box. A placeholder long enough to wrap
    // used to inflate the empty line to the height of the wrapped hint, so the
    // caret towered over the input until the first keystroke.
    expect(measured.empty).toBe(measured.typed);
    // ...and the hint must still be shown; hiding it would be a different bug.
    expect(measured.placeholderVisible).toBe(true);
  });
});

test.describe("list row semantics", () => {
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport navigation");

  test("exposes the project row's primary action as a real button", async ({ page }) => {
    await openApp(page);

    const row = await page.evaluate(() => {
      const list = document.querySelector("pi-web-app")?.shadowRoot
        ?.querySelector("app-navigation-panel")?.shadowRoot
        ?.querySelector("project-list")?.shadowRoot;
      const first = list?.querySelector(".action-row");
      const primary = first?.querySelector(".action-main");
      const menu = first?.querySelector(".action-menu-toggle");
      return {
        primaryTag: primary?.tagName.toLowerCase() ?? "(none)",
        // The actions button must remain a sibling: nesting one interactive
        // element inside another is invalid HTML and breaks assistive tech.
        menuInsidePrimary: primary !== null && primary !== undefined && menu !== null && menu !== undefined
          ? primary.contains(menu)
          : false,
        rowHasClickTabindex: first?.hasAttribute("tabindex") ?? false,
      };
    });

    expect(row.primaryTag).toBe("button");
    expect(row.menuInsidePrimary).toBe(false);
    // The row no longer doubles as a control, so focus lands on the button.
    expect(row.rowHasClickTabindex).toBe(false);
  });
});

test.describe("soft keyboard", () => {
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport behaviour");

  test("shortens the shell so the composer stays above the keyboard", async ({ page }) => {
    await openApp(page);

    const measured = await page.evaluate(async () => {
      const app = document.querySelector("pi-web-app");
      const viewport = window.visualViewport;
      if (app === null || viewport === null || viewport === undefined) return undefined;
      const read = (): string => (app as HTMLElement).style.getPropertyValue("--pi-app-keyboard-inset");
      const KEYBOARD = 320;

      const before = { inset: read(), host: Math.round(app.getBoundingClientRect().height) };

      // A soft keyboard shrinks the visual viewport and leaves the layout
      // viewport alone, which is exactly why 100dvh does not react to it.
      const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(viewport), "height");
      Object.defineProperty(viewport, "height", { configurable: true, get: () => window.innerHeight - KEYBOARD });
      Object.defineProperty(viewport, "offsetTop", { configurable: true, get: () => 0 });
      viewport.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const open = { inset: read(), host: Math.round(app.getBoundingClientRect().height) };

      Object.defineProperty(viewport, "height", { configurable: true, get: () => window.innerHeight });
      viewport.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const closed = { inset: read(), host: Math.round(app.getBoundingClientRect().height) };
      if (original !== undefined) Object.defineProperty(viewport, "height", original);

      return { before, open, closed, innerHeight: window.innerHeight, keyboard: KEYBOARD };
    });

    expect(measured).toBeDefined();
    expect(measured!.before.inset).toBe("0px");
    // The shell gives up exactly the height the keyboard covers; without this
    // the send button sat at y=799 with only 519px visible.
    expect(measured!.open.inset).toBe(`${String(measured!.keyboard)}px`);
    expect(measured!.open.host).toBe(measured!.innerHeight - measured!.keyboard);
    // ...and takes it back, or the app would stay short after typing.
    expect(measured!.closed.inset).toBe("0px");
    expect(measured!.closed.host).toBe(measured!.innerHeight);
  });
});

test.describe("desktop layout", () => {
  test.skip(({ isMobile }) => isMobile === true, "wide-viewport behaviour");

  test("does not spend half the window on an empty workspace panel", async ({ page }) => {
    await openApp(page);

    const measured = await page.evaluate(() => {
      const root = document.querySelector("pi-web-app")?.shadowRoot;
      const main = root?.querySelector("main");
      const panel = root?.querySelector("workspace-panel");
      return {
        mainWidth: Math.round(main?.getBoundingClientRect().width ?? 0),
        panelWidth: Math.round(panel?.getBoundingClientRect().width ?? 0),
        viewportWidth: window.innerWidth,
      };
    });

    // The panel is sized minmax(360px, 42vw), so before this it held 538px of a
    // 1280px window to show "Select a project" while the chat had 400px.
    expect(measured.panelWidth).toBe(0);
    expect(measured.mainWidth).toBeGreaterThan(measured.viewportWidth / 2);
  });
});

test.describe("navigation density", () => {
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport behaviour");

  test("does not stack a third bar above the list when it is redundant", async ({ page }) => {
    await openApp(page);

    const measured = await page.evaluate(() => {
      const panelRoot = document.querySelector("pi-web-app")?.shadowRoot
        ?.querySelector("app-navigation-panel")?.shadowRoot;
      const list = panelRoot?.querySelector("project-list")?.shadowRoot?.querySelector(".list-body");
      return {
        listTop: Math.round(list?.getBoundingClientRect().top ?? 0),
        quickActions: panelRoot?.querySelector(".mobile-quick-actions") !== null
          && panelRoot?.querySelector(".mobile-quick-actions") !== undefined,
        viewport: window.innerHeight,
      };
    });

    // Context bar + tab strip + quick actions used to push the list to y=199,
    // a fifth of the screen before any content.
    expect(measured.quickActions).toBe(false);
    expect(measured.listTop).toBeLessThan(measured.viewport / 5);
  });
});
