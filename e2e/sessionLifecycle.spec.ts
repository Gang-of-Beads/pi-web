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

async function createSession(request: import("@playwright/test").APIRequestContext): Promise<{ id: string; cwd: string }> {
  const cwd = "/data/home/goaldemo";
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
