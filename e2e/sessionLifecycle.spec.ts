import { expect, test } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";

// Daemon-facing behaviour: addressed at the API port, not the dev server.
test.use({ baseURL: apiBaseURL });

/**
 * Session lifecycle against the running daemon.
 *
 * These are the operations that failed in daily use, so they are asserted
 * end-to-end rather than only at the store: the reported failure came from the
 * archive route, and a store-level test alone would have kept passing.
 */
test.describe("archiving", () => {
  test("archives a session that has no transcript yet", async ({ request }) => {
    const { id, cwd } = await createSession(request);

    // A freshly created session has a path but no file. This is the exact case
    // that answered 400 with a raw ENOENT copyfile.
    const archived = await request.post(`/api/machines/local/sessions/${id}/archive`, { data: { cwd } });

    expect(archived.status()).toBe(200);
    expect(await archived.json()).toMatchObject({ archived: true });
  });

  test("keeps the archived session out of the active listing", async ({ request }) => {
    const { id, cwd } = await createSession(request);
    await request.post(`/api/machines/local/sessions/${id}/archive`, { data: { cwd } });

    const listed = await request.get(`/api/machines/local/sessions?cwd=${encodeURIComponent(cwd)}`);
    const sessions = await listed.json() as { id: string; archived?: boolean }[];

    const record = sessions.find((session) => session.id === id);
    expect(record?.archived).toBe(true);
  });

  test("restores an archived session that never had a file", async ({ request }) => {
    const { id, cwd } = await createSession(request);
    await request.post(`/api/machines/local/sessions/${id}/archive`, { data: { cwd } });

    const restored = await request.post(`/api/machines/local/sessions/${id}/restore`, { data: { cwd } });

    expect(restored.status()).toBe(200);
    const listed = await request.get(`/api/machines/local/sessions?cwd=${encodeURIComponent(cwd)}`);
    const sessions = await listed.json() as { id: string; archived?: boolean }[];
    expect(sessions.find((session) => session.id === id)?.archived).not.toBe(true);
  });
});

/**
 * Each run gets its own workspace.
 *
 * These tests create sessions and archive them, and an archived record is
 * durable by design. Sharing one workspace across runs therefore accumulates
 * archived sessions indefinitely — this suite had left 52 of them in the
 * container, which buries any real session behind a wall of test debris and
 * makes the navigation lists useless for manual checking. A per-run directory
 * keeps that debris out of the workspaces a human actually opens.
 */
const RUN_WORKSPACE = `/data/home/e2e-fixture-lifecycle/run-${String(Date.now())}`;

/**
 * The run's workspace directory, created inside one stable fixture project.
 *
 * Archived records are durable, so each run needs its own directory or the
 * archives pile up. Creating it through the project route would leave a project
 * behind on every run, which is the debris this is meant to avoid, so the
 * directory is made by writing a file into the fixture project's workspace with
 * `createDirs`.
 */
const FIXTURE_PROJECT = "/data/home/e2e-fixture-lifecycle";
let workspaceReady: Promise<void> | undefined;

async function ensureRunWorkspace(request: import("@playwright/test").APIRequestContext): Promise<void> {
  workspaceReady ??= (async () => {
    const project = await request.post("/api/projects", {
      data: { name: "e2e-fixture-lifecycle", path: FIXTURE_PROJECT, create: true },
    });
    expect(project.ok(), `fixture project: ${String(project.status())}`).toBe(true);
    const { id: projectId } = await project.json() as { id: string };

    const workspaces = await request.get(`/api/projects/${projectId}/workspaces`);
    const { workspaces: list } = await workspaces.json() as { workspaces: { id: string }[] };
    const workspaceId = list[0]?.id ?? "";

    const relative = `${RUN_WORKSPACE.slice(FIXTURE_PROJECT.length + 1)}/.keep`;
    const written = await request.put(
      `/api/projects/${projectId}/workspaces/${workspaceId}/file?path=${encodeURIComponent(relative)}&createDirs=true`,
      { data: Buffer.from("e2e run marker\n") },
    );
    expect(written.ok(), `create run directory: ${String(written.status())}`).toBe(true);
  })();
  await workspaceReady;
}

async function createSession(request: import("@playwright/test").APIRequestContext): Promise<{ id: string; cwd: string }> {
  await ensureRunWorkspace(request);
  const cwd = RUN_WORKSPACE;
  const response = await request.post("/api/machines/local/sessions", { data: { cwd } });
  expect(response.ok(), `create session: ${String(response.status())}`).toBe(true);
  const session = await response.json() as { id: string };
  return { id: session.id, cwd };
}

/**
 * Account-alias semantics, verified against the daemon rather than by reading
 * the extension's source.
 *
 * Skipped unless the daemon actually has Anthropic accounts configured, so the
 * suite still passes on a clean container. When they are present, selecting an
 * `anthropic-<account>` alias must leave the session on the canonical provider
 * — the alias is a selection entry point, not an identity to persist — and must
 * switch the active account.
 */
test.describe("anthropic account aliases", () => {
  test("normalises an alias to the canonical provider", async ({ request }) => {
    const { id, cwd } = await createSession(request);

    const models = await request.get(`/api/machines/local/sessions/${id}/models?cwd=${encodeURIComponent(cwd)}`);
    const { models: available } = await models.json() as { models: { provider?: string; id?: string }[] };
    const alias = available.find((model) => model.provider?.startsWith("anthropic-") === true);
    test.skip(alias === undefined, "daemon has no anthropic account aliases configured");

    const applied = await request.post(`/api/machines/local/sessions/${id}/model`, {
      data: { cwd, provider: alias?.provider, modelId: alias?.id },
    });

    expect(applied.status()).toBe(200);
    const status = await applied.json() as { model?: { provider?: string; id?: string } };
    // The alias must not survive as the session's provider.
    expect(status.model?.provider).toBe("anthropic");
    expect(status.model?.id).toBe(alias?.id);
  });
});
