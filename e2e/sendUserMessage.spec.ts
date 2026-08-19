import { expect, test } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";

// API tests address the API port directly; the default baseURL is the dev
// server that serves the client.
test.use({ baseURL: apiBaseURL });

/**
 * Extension-injected turn contract.
 *
 * A slash command whose handler calls pi.sendUserMessage() must start a real
 * agent turn in PI WEB: the kickoff is persisted and the session streams.
 * This drives the daemon through the same prompt API the browser uses, so it
 * exercises the real nested dispatch (command handler -> sendUserMessage ->
 * nested prompt) rather than a stub.
 */
test.describe("sendUserMessage from a command handler", () => {
  test("starts a turn and persists the kicked-off message", async ({ request }) => {
    const cwd = "/workspace";
    const create = await request.post("/api/machines/local/sessions", {
      data: { cwd },
    });
    expect(create.ok()).toBe(true);
    const session = await create.json() as { id: string };
    expect(session.id).toBeTruthy();

    try {
      const prompt = await request.post(`/api/machines/local/sessions/${session.id}/prompt`, {
        data: { cwd, text: "/feynman_teach What is NAT?" },
      });
      expect(prompt.ok()).toBe(true);

      // The turn must start (streaming observed) within a short window.
      let sawStreaming = false;
      for (let i = 0; i < 15; i++) {
        const statusResp = await request.get(`/api/machines/local/sessions/${session.id}/status?cwd=${encodeURIComponent(cwd)}`);
        expect(statusResp.ok()).toBe(true);
        const status = await statusResp.json() as { isStreaming?: boolean; messageCount?: number };
        if (status.isStreaming === true) {
          sawStreaming = true;
          expect(status.messageCount ?? 0).toBeGreaterThanOrEqual(1);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      expect(sawStreaming).toBe(true);
    } finally {
      await request.post(`/api/machines/local/sessions/${session.id}/archive`, { data: { cwd } });
    }
  });
});

test.describe("recovery: no turn, no hang", () => {
  test("an unknown slash command still returns promptly without corrupting status", async ({ request }) => {
    const cwd = "/workspace";
    const create = await request.post("/api/machines/local/sessions", { data: { cwd } });
    expect(create.ok()).toBe(true);
    const session = await create.json() as { id: string };
    try {
      const prompt = await request.post(`/api/machines/local/sessions/${session.id}/prompt`, {
        data: { cwd, text: "/definitely_not_a_command xyz" },
      });
      expect(prompt.ok()).toBe(true);
      // The session must come back to a readable status quickly.
      const statusResp = await request.get(`/api/machines/local/sessions/${session.id}/status?cwd=${encodeURIComponent(cwd)}`);
      expect(statusResp.ok()).toBe(true);
    } finally {
      await request.post(`/api/machines/local/sessions/${session.id}/archive`, { data: { cwd } });
    }
  });
});
