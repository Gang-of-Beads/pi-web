import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPublishedEntry, readSiteIgnore } from "./docsSiteEntries.mjs";

const docsDir = fileURLToPath(new URL("../docs/", import.meta.url));

/**
 * The docs site deployed docs/ wholesale, so docs/design (agent lane output, review triage,
 * local machine paths) was public. Only the site's pages and the two references they link to
 * are published; the rule lives in docs/.assetsignore and both deploys read it.
 */
describe("what the docs site publishes", () => {
  const patterns = readSiteIgnore(docsDir);
  const published = readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => isPublishedEntry(entry.name, entry.isDirectory(), patterns))
    .map((entry) => entry.name);

  it("serves the pages, their styles and assets, and the two linked references", () => {
    for (const name of ["index.html", "config.html", "faq.html", "styles.css", "site.js", "assets", "config.md", "plugins.md"]) {
      expect(published).toContain(name);
    }
  });

  it("serves no design record, working note or deploy config", () => {
    expect(published.filter((name) => name === "design" || (name.endsWith(".md") && name !== "config.md" && name !== "plugins.md") || name.startsWith("wrangler") || name.startsWith("."))).toEqual([]);
  });
});
