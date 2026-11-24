import { describe, expect, it } from "vitest";
import { resolveAppUrl, resolveAppWebSocketUrl, type AppUrlContext } from "./appUrl";

const rootHttpContext: AppUrlContext = {
  viteBaseUrl: "/",
  documentBaseUrl: "http://pi.example.test/",
};

const nestedHttpsContext: AppUrlContext = {
  viteBaseUrl: "./",
  documentBaseUrl: "https://pi.example.test/test/ai/",
};

describe("application URLs", () => {
  it("resolves app-owned paths at an HTTP root deployment", () => {
    expect(resolveAppUrl("api/pi-web/status", rootHttpContext)).toBe("http://pi.example.test/api/pi-web/status");
    expect(resolveAppUrl("/pi-web-plugins/manifest.json", rootHttpContext)).toBe("http://pi.example.test/pi-web-plugins/manifest.json");
  });

  it("resolves paths within a canonical nested HTTPS deployment", () => {
    expect(resolveAppUrl("api/pi-web/status", nestedHttpsContext)).toBe("https://pi.example.test/test/ai/api/pi-web/status");
    expect(resolveAppUrl("/pi-web-plugins/manifest.json", nestedHttpsContext)).toBe("https://pi.example.test/test/ai/pi-web-plugins/manifest.json");
  });

  it("preserves encoded path segments and query parameters", () => {
    expect(resolveAppUrl("api/machines/remote%20a/sessions/s%2F1/events?cwd=%2Frepo+one&before=10", nestedHttpsContext))
      .toBe("https://pi.example.test/test/ai/api/machines/remote%20a/sessions/s%2F1/events?cwd=%2Frepo+one&before=10");
  });
});

describe("application WebSocket URLs", () => {
  it("maps root HTTP URLs to absolute ws URLs", () => {
    expect(resolveAppWebSocketUrl("api/machines/local/events", rootHttpContext)).toBe("ws://pi.example.test/api/machines/local/events");
  });

  it("maps nested HTTPS URLs to absolute wss URLs without losing path or query data", () => {
    expect(resolveAppWebSocketUrl("api/machines/remote%20a/sessions/s%2F1/events?cwd=%2Frepo+one", nestedHttpsContext))
      .toBe("wss://pi.example.test/test/ai/api/machines/remote%20a/sessions/s%2F1/events?cwd=%2Frepo+one");
  });

  it("sends a machine this browser reaches itself its token in the path, sockets included", () => {
    const context: AppUrlContext = { ...nestedHttpsContext, directMachines: new Map([["m1", { baseUrl: "https://machine.example:8504", accessToken: "a/b+c=" }]]) };
    expect([
      resolveAppUrl("api/machines/m1/sessions/s1/messages?cwd=%2Frepo", context),
      resolveAppWebSocketUrl("api/machines/m1/sessions/s1/events?cwd=%2Frepo", context),
      resolveAppWebSocketUrl("api/machines/m1/terminals/t1/socket", context),
      resolveAppUrl("api/machines/m1", context),
      resolveAppUrl("api/machines/other/sessions", context),
    ]).toEqual([
      "https://machine.example:8504/access-token/a%2Fb%2Bc%3D/api/sessions/s1/messages?cwd=%2Frepo",
      "wss://machine.example:8504/access-token/a%2Fb%2Bc%3D/api/sessions/s1/events?cwd=%2Frepo",
      "wss://machine.example:8504/access-token/a%2Fb%2Bc%3D/api/terminals/t1/socket",
      "https://pi.example.test/test/ai/api/machines/m1",
      "https://pi.example.test/test/ai/api/machines/other/sessions",
    ]);
  });
});
