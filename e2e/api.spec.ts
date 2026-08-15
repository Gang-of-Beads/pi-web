import { expect, test } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";

// API tests address the API port directly; the default baseURL is the dev
// server that serves the client.
test.use({ baseURL: apiBaseURL });

/**
 * Contract checks for the endpoints the browser depends on.
 *
 * These run against the isolated container, so they assert real daemon
 * behaviour rather than a stubbed route table.
 */

test.describe("session status catalog", () => {
  test("hydrates work state for a fresh browser", async ({ request }) => {
    const response = await request.get("/api/machines/local/sessions/statuses");

    expect(response.ok()).toBe(true);
    const body = await response.json() as { statuses: unknown[]; generatedAt: string };
    expect(Array.isArray(body.statuses)).toBe(true);
    // A timestamp is what lets a client reason about snapshot freshness
    // against the live events that race it.
    expect(Number.isFinite(Date.parse(body.generatedAt))).toBe(true);
  });

  test("does not capture 'statuses' as a session id", async ({ request }) => {
    // A greedy `/sessions/:sessionId` route would answer 404 here forever.
    const response = await request.get("/api/machines/local/sessions/statuses");
    expect(response.status()).toBe(200);
  });
});

test.describe("workspace goals", () => {
  test("reports an empty, well-formed listing for a workspace with no goals", async ({ request }) => {
    const project = await request.post("/api/projects", {
      data: { name: `e2e-empty-${String(Date.now())}`, path: `/data/home/e2e-empty-${String(Date.now())}`, create: true },
    });
    expect(project.ok()).toBe(true);
    const { id } = await project.json() as { id: string };

    const workspaces = await request.get(`/api/projects/${id}/workspaces`);
    const { workspaces: list } = await workspaces.json() as { workspaces: { id: string }[] };
    const workspaceId = list[0]?.id ?? "";

    const goals = await request.get(`/api/projects/${id}/workspaces/${workspaceId}/goals`);

    expect(goals.ok()).toBe(true);
    const body = await goals.json() as { goals: unknown[]; directory: string };
    expect(body.goals).toEqual([]);
    // The directory is reported even when absent, so the UI can explain where
    // goals would come from.
    expect(body.directory).toContain(".pi/goals");
  });
});
