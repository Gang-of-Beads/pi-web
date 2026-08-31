import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { PiWebConfigResponse } from "../../shared/apiTypes.js";
import type { PiWebConfigService } from "./configRoutes.js";

/**
 * What a browser holding a cached page from the previous build gets.
 *
 * Reported as "the page is black, but incognito works", which is what a blank
 * SPA looks like from the outside. The cached index.html names hashed assets
 * from the build that produced it; after an upgrade those names are gone, and
 * the not-found handler answered them with index.html - so a <script> tag
 * received HTML, threw on the first `<`, and rendered nothing. Incognito had no
 * cached document, so it was fine, which made it look like a data problem
 * rather than a caching one.
 */

async function clientDistWithAssets(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-client-dist-"));
  await writeFile(join(dir, "index.html"), "<!doctype html><html><body>app</body></html>", "utf8");
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "assets", "index-CURRENT.js"), "export const ok = true;\n", "utf8");
  return dir;
}

/** The smallest config service buildApp accepts; nothing here reads it. */
function emptyConfigService(): PiWebConfigService {
  const response: PiWebConfigResponse = {
    path: join(tmpdir(), "pi-web-static-assets-config.json"),
    exists: false,
    config: {},
    effectiveConfig: {},
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false },
  };
  return { read: () => Promise.resolve(response), write: () => Promise.resolve(response) };
}

async function appWithClient() {
  return buildApp({
    config: emptyConfigService(),
    clientDist: await clientDistWithAssets(),
    logger: false,
  });
}

describe("static client assets", () => {
  it("404s an asset that no longer exists instead of serving the document", async () => {
    const app = await appWithClient();
    try {
      const response = await app.inject({ method: "GET", url: "/assets/index-FROM-A-PREVIOUS-BUILD.js" });

      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).not.toContain("text/html");
    } finally {
      await app.close();
    }
  });

  it("still serves the document for an application route", async () => {
    // The fallback exists for client-side routing and must keep working.
    const app = await appWithClient();
    try {
      const response = await app.inject({ method: "GET", url: "/projects/some/deep/route" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
    } finally {
      await app.close();
    }
  });

  it("tells the browser never to cache the document", async () => {
    // index.html is the one file whose name never changes, so a cached copy is
    // how an upgrade fails to reach someone.
    const app = await appWithClient();
    try {
      const response = await app.inject({ method: "GET", url: "/index.html" });

      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });

  it("lets hashed assets be cached forever", async () => {
    const app = await appWithClient();
    try {
      const response = await app.inject({ method: "GET", url: "/assets/index-CURRENT.js" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toContain("immutable");
    } finally {
      await app.close();
    }
  });
});
