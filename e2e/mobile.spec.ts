import { expect, test, type Page } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";
import { CONTAINER_HOME } from "./fixtures";

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

  test("goes straight to sessions when the project has only one workspace", async ({ page }) => {
    // A stable fixture, not a per-run name: the project route is idempotent for
    // an existing path, and a fresh name each run left 127 test projects in the
    // container, which buries the real ones in the navigation list.
    const name = "e2e-fixture-nav";
    await createProjectViaApi(page, name);
    await openApp(page);

    await clickRow(page, "project-list", name);
    await page.waitForTimeout(1500);

    const sections = await page.evaluate(() => {
      const panelRoot = document.querySelector("pi-web-app")?.shadowRoot
        ?.querySelector("app-navigation-panel")?.shadowRoot;
      return sectionGeometry(panelRoot);
    });

    const visible = sections.filter((section) => section.height > 0);
    // A workspace is a git worktree, so that step earns its place when a
    // project has several. With one, it listed a single option the app had
    // already selected, so it asked for a tap that changed nothing.
    expect(visible.map((section) => section.tag)).toEqual(["session-list"]);
    // The reported symptom this fixed originally: the list existed but sat
    // below a full screen of collapsed sections, unreachable without scrolling.
    const sessions = visible[0];
    expect(sessions).toBeDefined();
    expect(sessions!.top).toBeLessThan(400);
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

      // The hint must sit exactly where the first keystroke lands: a
      // placeholder that is absolute against the box edge starts left of the
      // text padding, so the caret visibly overlaps the first character.
      const textLeft = (element: Element | null | undefined) => {
        if (element === null || element === undefined) return null;
        const range = document.createRange();
        range.selectNodeContents(element);
        return Math.round(range.getBoundingClientRect().left);
      };
      const placeholderLeft = textLeft(placeholder);

      editor.replaceText("typed");
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const typedLeft = textLeft(root?.querySelector(".cm-line"));

      return { empty, typed: lineHeight(), placeholderVisible, placeholderLeft, typedLeft };
    });

    // The caret is sized from the line box. A placeholder long enough to wrap
    // used to inflate the empty line to the height of the wrapped hint, so the
    // caret towered over the input until the first keystroke.
    expect(measured.empty).toBe(measured.typed);
    // ...and the hint must still be shown; hiding it would be a different bug.
    expect(measured.placeholderVisible).toBe(true);
    // The hint and the text share an origin: the caret sat one character over
    // the first letter when the placeholder anchored to the box edge instead.
    expect(measured.placeholderLeft).not.toBeNull();
    expect(measured.typedLeft).not.toBeNull();
    expect(measured.placeholderLeft).toBe(measured.typedLeft);
  });

  test("stacks pending attachments above the input, not between it and the send button", async ({ page }) => {
    await openApp(page);

    const measured = await page.evaluate(async () => {
      const editor = document.createElement("prompt-editor") as HTMLElement & {
        machineId?: string;
        sessionId?: string;
        cwd?: string;
        attachments?: unknown[];
        requestUpdate: () => void;
        updateComplete: Promise<unknown>;
      };
      editor.machineId = "local";
      editor.sessionId = "attachment-probe";
      editor.cwd = "/tmp";
      document.body.append(editor);
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 400));

      // A 1x1 PNG: the smallest thing that still exercises the image path.
      editor.attachments = [
        {
          id: "a1", name: "screenshot.png", kind: "image", mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        },
        { id: "a2", name: "notes.txt", kind: "file", mimeType: "text/plain", data: "aGVsbG8=" },
      ];
      editor.requestUpdate();
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 300));

      const root = editor.shadowRoot;
      const rect = (selector: string) => {
        const box = root?.querySelector(selector)?.getBoundingClientRect();
        return box === undefined ? undefined : { top: Math.round(box.top), bottom: Math.round(box.bottom) };
      };
      const chips = [...(root?.querySelectorAll(".attachment-chip") ?? [])];
      return {
        attachments: rect(".attachments"),
        input: rect(".cm-editor"),
        chipClasses: chips.map((chip) => chip.className.replace("attachment-chip ", "")),
        everyChipRemovable: chips.length > 0 && chips.every((chip) => chip.querySelector(".attachment-remove") !== null),
        imageHasThumbnail: chips[0]?.querySelector("img") !== null,
      };
    });

    // Attachments belong above the text, where they do not push the send button
    // off a phone screen and are visible while the message is being written.
    expect(measured.attachments).toBeDefined();
    expect(measured.input).toBeDefined();
    expect(measured.attachments!.bottom).toBeLessThanOrEqual(measured.input!.top);

    // An image is shown as an image; a file that cannot be inlined is not
    // dressed up as one, because that difference decides how it is delivered.
    expect(measured.chipClasses).toEqual(["attachment-chip-image", "attachment-chip-file"]);
    expect(measured.imageHasThumbnail).toBe(true);
    // Every attachment must be removable: picking the wrong file otherwise
    // means discarding the whole message to correct it.
    expect(measured.everyChipRemovable).toBe(true);
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

test.describe("transient errors", () => {
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport behaviour");

  test("withdraws a reconnect notice but keeps a real failure", async ({ page }) => {
    await openApp(page);

    const show = async (message: string) => page.evaluate((error) => {
      const app = document.querySelector("pi-web-app") as (HTMLElement & {
        state?: Record<string, unknown>;
        requestUpdate: () => void;
        updateComplete: Promise<unknown>;
      }) | null;
      if (app !== null && app.state !== undefined) app.state = { ...app.state, error };
      app?.requestUpdate();
      return app?.updateComplete.then(() => {
        const banner = app.shadowRoot?.querySelector(".error");
        const box = banner?.getBoundingClientRect();
        return banner === null || banner === undefined ? null : {
          role: banner.getAttribute("role"),
          text: (banner.textContent ?? "").replace(/\s+/g, " ").trim(),
          heightFraction: box === undefined ? 1 : box.height / window.innerHeight,
        };
      });
    }, message);

    const stillShown = async () => page.evaluate(() =>
      document.querySelector("pi-web-app")?.shadowRoot?.querySelector(".error") !== null);

    // The message a dropped session daemon really produces. An earlier rule
    // matched only a wrapped form that never reaches this banner, so it looked
    // handled while a cancelled request still got the full failure treatment.
    const reconnect = await show("Session daemon workspace authority unavailable: connect ENOENT /run/user/1000/pi-web/sessiond.sock");
    expect(reconnect?.role).toBe("status");
    // Rewritten into what the user can do about it, not transport wording.
    expect(reconnect?.text).toContain("Reconnecting");
    // Lightweight: it must not take a meaningful share of a phone screen.
    expect(reconnect?.heightFraction).toBeLessThan(0.12);

    const aborted = await show("AbortError: The operation was aborted.");
    expect(aborted?.role).toBe("status");

    // ...and it withdraws on its own, so a reconnect notice cannot outlive the
    // reconnect it describes.
    await page.waitForTimeout(7000);
    expect(await stillShown()).toBe(false);

    // A real failure is never expired: it waits to be read and dismissed.
    const real = await show("Session not found: no such file or directory");
    expect(real?.role).toBe("alert");
    await page.waitForTimeout(7000);
    expect(await stillShown()).toBe(true);
  });
});

test.describe("quick switcher", () => {
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport behaviour");

  test("finds a session with no workspace selected and opens it in one tap", async ({ page, request }) => {
    // A session on a workspace the app has not been pointed at. Finding this
    // without first navigating to its workspace is the point of the switcher.
    const cwd = `${CONTAINER_HOME}/e2e-fixture-lifecycle`;
    await request.put(
      `/api/machines/local/workspace/file?path=${encodeURIComponent(`${cwd}/.keep`)}&createDirs=true`,
      { data: "" },
    );
    const created = await request.post("/api/machines/local/sessions", { data: { cwd } });
    expect(created.ok(), `create session: ${String(created.status())}`).toBe(true);
    const { id } = await created.json() as { id: string };

    await openApp(page);

    // Opened the way a user does with nothing selected: the "Open Session"
    // shortcut. Setting the open flag directly skips the machine-wide load that
    // happens on open, so a test that does that proves nothing.
    const before = await page.evaluate(() => {
      const app = document.querySelector("pi-web-app") as (HTMLElement & {
        state?: { selectedWorkspace?: unknown };
      }) | null;
      return { workspaceSelected: app?.state?.selectedWorkspace !== undefined && app?.state?.selectedWorkspace !== null };
    });

    // Searchable with nothing selected: the list is populated from the whole
    // machine, not from a workspace the user had to pick first.
    expect(before.workspaceSelected).toBe(false);

    await page.keyboard.press("ControlOrMeta+p");
    // The switcher loads every project's sessions when it opens.
    await page.waitForTimeout(3000);

    const opened = await page.evaluate((sessionId) => {
      const app = document.querySelector("pi-web-app") as (HTMLElement & {
        state?: { selectedSession?: { id?: string } };
      }) | null;
      const root = app?.shadowRoot?.querySelector("quick-switcher")?.shadowRoot;
      const rows = [...(root?.querySelectorAll(".session-row") ?? [])];
      const match = rows.find((row) => (row as HTMLElement).textContent?.includes(sessionId.slice(-8)) === true) ?? rows[0];
      (match as HTMLElement | undefined)?.click();
      return { rowCount: rows.length };
    }, id);
    await page.waitForTimeout(2000);

    expect(opened.rowCount).toBeGreaterThan(0);

    // And a single tap lands in a session, rather than only navigating closer.
    const selected = await page.evaluate(() =>
      (document.querySelector("pi-web-app") as (HTMLElement & { state?: { selectedSession?: { id?: string } } }) | null)
        ?.state?.selectedSession?.id);
    expect(selected).toBeDefined();
  });
});

test.describe("prompt history", () => {
  test.skip(({ isMobile }) => isMobile === true, "physical-keyboard behaviour");

  test("walks further back on each Up and returns on Down", async ({ page }) => {
    await openApp(page);

    await page.evaluate(async () => {
      // Seed the store the composer really reads, keyed by machine and session.
      // Index 0 is the most recent entry.
      localStorage.setItem(
        "pi-web:prompt-history:local:history-probe",
        JSON.stringify(["third message", "second message", "first message"]),
      );
      const editor = document.createElement("prompt-editor") as HTMLElement & {
        machineId?: string;
        sessionId?: string;
        cwd?: string;
        updateComplete: Promise<unknown>;
      };
      editor.machineId = "local";
      editor.sessionId = "history-probe";
      editor.cwd = "/tmp";
      editor.id = "history-probe-editor";
      document.body.append(editor);
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 500));
      (editor.shadowRoot?.querySelector(".cm-content") as HTMLElement | null)?.focus();
    });

    const text = async () => page.evaluate(() =>
      document.querySelector("#history-probe-editor")?.shadowRoot?.querySelector(".cm-content")?.textContent ?? "");

    const seen: string[] = [];
    for (const key of ["ArrowUp", "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(200);
      seen.push(await text());
    }

    // Up means further back in time, as in every shell and in pi's own terminal
    // UI. The steps were once passed as +1/-1 and wired the wrong way round, so
    // Up reached the most recent entry and appeared to stop while Down walked
    // backwards -- a single press looked correct, which is why it survived.
    expect(seen).toEqual([
      "third message",
      "second message",
      "first message",
      "second message",
      "third message",
    ]);
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

test.describe("touch targets", () => {
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport behaviour");

  // The audits measure tap height, not style presence: a control can carry
  // padding and still be too small to hit reliably.
  test("keeps primary controls at a tappable height", async ({ page }) => {
    await openApp(page);

    const measured = await page.evaluate(async () => {
      const app = document.querySelector("pi-web-app") as (HTMLElement & { updateComplete: Promise<unknown> }) | null;
      const barRoot = app?.shadowRoot?.querySelector("app-context-bar")?.shadowRoot;

      const height = (root: ShadowRoot | null | undefined, selector: string) => {
        const box = root?.querySelector(selector)?.getBoundingClientRect();
        return box === undefined || box === null ? null : Math.round(box.height);
      };
      const editor = document.createElement("prompt-editor") as HTMLElement & {
        machineId?: string; sessionId?: string; cwd?: string; status?: unknown; updateComplete: Promise<unknown>;
      };
      editor.machineId = "local"; editor.sessionId = "touch-probe"; editor.cwd = "/tmp";
      // The model selector only renders once a session status exists: a bare
      // mount would claim "no selector" while every real conversation has one.
      editor.status = { model: { provider: "anthropic", id: "claude-opus-5" } };
      (app?.shadowRoot ?? document.body).append(editor);
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 400));

      // The landing bar is the location trail; the session-led layout comes
      // later. Either way every control here is a primary tap target, so every
      // one of them that exists must clear the floor.
      return {
        chips: [...(barRoot?.querySelectorAll(".context-chip") ?? [])]
          .map((chip) => Math.round(chip.getBoundingClientRect().height)),
        breadcrumb: height(barRoot, ".context-breadcrumb"),
        sessionTitle: height(barRoot, ".context-session-title"),
        modelSelector: height(editor.shadowRoot, ".select-model"),
        sendButton: height(editor.shadowRoot, ".send-button"),
        attachButton: height(editor.shadowRoot, ".editor-attach"),
      };
    });

    // The context bar is the primary navigation on a phone.
    const barTargets = [measured.breadcrumb, measured.sessionTitle, ...(measured.chips ?? [])].filter(
      (value): value is number => value !== null && value !== undefined,
    );
    expect(barTargets.length).toBeGreaterThan(0);
    for (const value of barTargets) expect(value).toBeGreaterThanOrEqual(40);
    // Composer controls are used dozens of times per conversation.
    for (const [label, value] of [["model", measured.modelSelector], ["send", measured.sendButton]]) {
      expect(value, label).not.toBeNull();
      expect(value, label).toBeGreaterThanOrEqual(36);
    }
    expect(measured.attachButton, "attach").toBeGreaterThanOrEqual(30);
  });
});

test.describe("quick switcher", () => {
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport behaviour");

  test("offers context filters and a row menu without squashing the list", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const bar = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-context-bar")?.shadowRoot;
      const button = [...(bar?.querySelectorAll("button") ?? [])]
        .find((candidate) => (candidate.getAttribute("aria-label") ?? "").toLowerCase().includes("session"));
      button?.click();
    });
    // The sheet renders before its data arrives; the chips exist once the
    // workspaces it groups by have loaded.
    await page.waitForFunction(() => {
      const sheet = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("quick-switcher")?.shadowRoot;
      return (sheet?.querySelectorAll(".chip").length ?? 0) > 0;
    }, undefined, { timeout: 20_000 });

    const measured = await page.evaluate(() => {
      const sheet = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("quick-switcher")?.shadowRoot;
      const filters = sheet?.querySelector(".filters")?.getBoundingClientRect();
      const chip = sheet?.querySelector(".chip")?.getBoundingClientRect();
      return {
        chipLabels: [...(sheet?.querySelectorAll(".chip") ?? [])].map((element) => element.textContent?.trim() ?? ""),
        menus: sheet?.querySelectorAll(".row-menu-toggle").length ?? 0,
        filtersHeight: Math.round(filters?.height ?? 0),
        chipHeight: Math.round(chip?.height ?? 0),
      };
    });

    // "All" is focus mode: no filter chosen means every workspace's sessions.
    expect(measured.chipLabels[0]).toBe("All");
    // A project whose only workspace shares its name must not print twice.
    expect(new Set(measured.chipLabels).size).toBe(measured.chipLabels.length);
    // The chip row is its own band; a squashed one used to overlap the list.
    expect(measured.filtersHeight).toBeGreaterThanOrEqual(measured.chipHeight);
    expect(measured.menus).toBeGreaterThan(0);
  });
});
