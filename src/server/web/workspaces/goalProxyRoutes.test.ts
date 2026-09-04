import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerGoalProxyRoutes } from "./goalProxyRoutes";
import type { ProjectService } from "../../shared/projects/projectService";
import type { WorkspaceCatalog } from "../../shared/workspaces/workspaceCatalog";
import type { SessionDaemonRequestClient } from "../../shared/sessiondClient/sessionDaemonClient";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const projects: Pick<ProjectService, "requireProject"> = {
  requireProject: () => Promise.resolve({ id: "p1", name: "repo", path: "/repo", createdAt: "now" }),
};

const workspaces: Pick<WorkspaceCatalog, "resolve"> = {
  resolve: () => Promise.resolve({ id: "w1", projectId: "p1", path: "/repo", label: "repo", isMain: true }),
};

async function serve(request: SessionDaemonRequestClient["request"]): Promise<FastifyInstance> {
  const instance = Fastify();
  registerGoalProxyRoutes(instance, projects, workspaces, { request });
  await instance.ready();
  app = instance;
  return instance;
}

describe("the goal routes in front of the goals plugin", () => {
  it("reads through the plugin's own operation, naming the workspace the host resolved", async () => {
    const seen: { path: string; payload: unknown }[] = [];
    const server = await serve((_method, path, payload) => {
      seen.push({ path, payload });
      return Promise.resolve({ statusCode: 200, headers: {}, body: JSON.stringify({ goals: [], directory: "/repo/.pi/goals", generatedAt: "now" }) });
    });

    const response = await server.inject({ method: "GET", url: "/api/projects/p1/workspaces/w1/goals?sessionCwd=/repo/sub" });

    expect(response.statusCode).toBe(200);
    expect(seen[0]?.path).toBe("/plugin-operations/goals/goals.read");
    expect(seen[0]?.payload).toEqual({ workspacePath: "/repo", sessionCwd: "/repo/sub" });
    expect(response.json()).toMatchObject({ directory: "/repo/.pi/goals" });
  });

  it("keeps a locked archive a distinct answer from an invalid request", async () => {
    const server = await serve(() => Promise.resolve({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ refused: true, code: "locked", message: "Another session holds this goal" }),
    }));

    const response = await server.inject({ method: "POST", url: "/api/projects/p1/workspaces/w1/goals/g1/archive" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "locked" });
  });

  it("reports an ordinary refusal as a bad request rather than as a lock", async () => {
    const server = await serve(() => Promise.resolve({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ refused: true, code: "invalid", message: "No such goal" }),
    }));

    const response = await server.inject({ method: "POST", url: "/api/projects/p1/workspaces/w1/goals/g1/archive" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "invalid", error: "No such goal" });
  });

  it("passes an archive through when the plugin performed it", async () => {
    const server = await serve(() => Promise.resolve({ statusCode: 200, headers: {}, body: JSON.stringify({ archived: "g1" }) }));

    const response = await server.inject({ method: "POST", url: "/api/projects/p1/workspaces/w1/goals/g1/archive" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ archived: "g1" });
  });

  it("says the plugin refused rather than reporting goals it never received", async () => {
    const server = await serve(() => Promise.resolve({ statusCode: 404, headers: {}, body: JSON.stringify({ error: "No plugin operation named goals.read" }) }));

    const response = await server.inject({ method: "GET", url: "/api/projects/p1/workspaces/w1/goals" });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain("No plugin operation named goals.read");
  });
});
