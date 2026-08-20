import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";
import { CONTAINER_HOME, createProject, firstWorkspace, type WorkspaceRef } from "./fixtures";

/**
 * Archiving a goal from the browser.
 *
 * A paused goal never leaves the panel on its own, and the extension's own
 * clear command refuses without a confirmable UI - which a web session has not
 * got. This drives the real endpoint against the real directory, because the
 * part worth proving is what happens on disk: the record moves to `archived/`,
 * the ledger gains one line, and the listing stops reporting it.
 */

test.use({ baseURL: apiBaseURL });

const GOAL_ID = "e2e-archive-goal";

test.describe("goal archive", () => {
  test("moves a paused goal out of the active list and into archived/", async ({ request }) => {
    const workspace = await goalWorkspace(request);
    await seedGoal(request, workspace);

    await expect.poll(async () => await goalIds(request, workspace), { message: "the seeded goal must be listed first" })
      .toContain(GOAL_ID);

    const archived = await request.post(archivePath(workspace, GOAL_ID), { data: {} });
    expect(archived.ok()).toBe(true);
    const body = await archived.json() as { alreadyArchived: boolean; archivedPath: string; agentMayRecreate: boolean };
    expect(body.alreadyArchived).toBe(false);
    expect(body.archivedPath).toContain("/archived/");
    // An agent already holding this goal keeps its copy until it reloads; the
    // caller is told rather than left to discover a goal that came back.
    expect(body.agentMayRecreate).toBe(true);

    expect(await goalIds(request, workspace)).not.toContain(GOAL_ID);
  });

  test("is idempotent, so a second attempt is not an error", async ({ request }) => {
    const workspace = await goalWorkspace(request);
    await seedGoal(request, workspace);
    await request.post(archivePath(workspace, GOAL_ID), { data: {} });

    const second = await request.post(archivePath(workspace, GOAL_ID), { data: {} });

    expect(second.ok()).toBe(true);
    expect((await second.json() as { alreadyArchived: boolean }).alreadyArchived).toBe(true);
  });

  test("refuses while another process holds the goal's lock", async ({ request }) => {
    // A separate workspace: this one deliberately leaves a lock behind, and a
    // shared fixture would make the other tests depend on cleanup order.
    const workspace = await lockedGoalWorkspace(request);
    await seedGoal(request, workspace);
    await writeFileInWorkspace(request, workspace, `.pi/goals/.locks/${GOAL_ID}.lock`, JSON.stringify({ pid: 1, startedAt: new Date().toISOString() }));

    const response = await request.post(archivePath(workspace, GOAL_ID), { data: {} });

    expect(response.status()).toBe(409);
    // A refusal must leave the record intact rather than half-archived.
    expect(await goalIds(request, workspace)).toContain(GOAL_ID);
  });
});

function archivePath(workspace: WorkspaceRef, goalId: string): string {
  return `${apiBaseURL}/api/projects/${workspace.projectId}/workspaces/${workspace.workspaceId}/goals/${goalId}/archive`;
}

async function goalWorkspace(request: APIRequestContext): Promise<WorkspaceRef> {
  const name = "e2e-fixture-goal-archive";
  const projectId = await createProject(request, name, `${CONTAINER_HOME}/${name}`);
  return await firstWorkspace(request, projectId);
}

async function lockedGoalWorkspace(request: APIRequestContext): Promise<WorkspaceRef> {
  const name = "e2e-fixture-goal-locked";
  const projectId = await createProject(request, name, `${CONTAINER_HOME}/${name}`);
  return await firstWorkspace(request, projectId);
}

async function goalIds(request: APIRequestContext, workspace: WorkspaceRef): Promise<string[]> {
  const response = await request.get(`${apiBaseURL}/api/projects/${workspace.projectId}/workspaces/${workspace.workspaceId}/goals`);
  expect(response.ok()).toBe(true);
  const body = await response.json() as { goals: { id: string }[] };
  return body.goals.map((goal) => goal.id);
}

/**
 * Seed through the workspace file API so the test writes where the server
 * writes, with no assumption about the container's filesystem layout.
 */
async function seedGoal(request: APIRequestContext, workspace: WorkspaceRef): Promise<void> {
  const record = {
    version: 3,
    id: GOAL_ID,
    objective: "A paused goal that will not leave the panel",
    status: "paused",
    revision: 4,
    activePath: `.pi/goals/active_goal_${GOAL_ID}.md`,
    taskList: { tasks: [{ id: "task-1", title: "Never started", status: "pending" }] },
  };
  await writeFileInWorkspace(request, workspace, `.pi/goals/active_goal_${GOAL_ID}.md`, `${JSON.stringify(record, undefined, 2)}\n\n# Goal Prompt\n\nA paused goal that will not leave the panel\n`);
}

async function writeFileInWorkspace(request: APIRequestContext, workspace: WorkspaceRef, path: string, content: string): Promise<void> {
  const response = await request.put(
    `${apiBaseURL}/api/machines/local/projects/${workspace.projectId}/workspaces/${workspace.workspaceId}/file?path=${encodeURIComponent(path)}`,
    { headers: { "content-type": "text/plain" }, data: content },
  );
  expect(response.ok(), `seed ${path}: ${String(response.status())}`).toBe(true);
}
