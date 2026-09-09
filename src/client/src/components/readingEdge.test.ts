import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(join(process.cwd(), "src/client/index.html"), "utf8");

/**
 * The reading edge is a role, not an arithmetic step: the distance from the
 * screen edge to text a person reads, in lists, sheets and panels. It was five
 * private answers (6, 10, 12, 15, 16 measured on one phone screen) because the
 * scale named steps and nothing named the role. The contract keeps the token
 * published at both breakpoints and catches the next list that answers the
 * question privately again.
 */
describe("the reading edge", () => {
  const read = (token: string): string | undefined => new RegExp(`${token}:\\s*([^;]+)`, "u").exec(indexHtml)?.[1]?.trim();

  it("is published once per breakpoint, derived from the scale", () => {
    const definitions = indexHtml.match(/--pi-reading-edge:[^;]+;/gu) ?? [];
    expect(definitions).toHaveLength(2);
    expect(definitions.every((definition) => definition.includes("var(--pi-space-"))).toBe(true);
  });

  it("narrows on the phone, where every pixel is the reader's", () => {
    const desktop = read("--pi-reading-edge") ?? "";
    const phoneBlock = indexHtml.slice(indexHtml.indexOf("(max-width: 640px)"));
    const phone = /--pi-reading-edge:\s*([^;]+)/u.exec(phoneBlock)?.[1]?.trim() ?? "";
    expect(desktop).toBe("var(--pi-space-7)");
    expect(phone).toBe("var(--pi-space-5)");
  });

  it("is the edge the shared list row actually uses", () => {
    const shared = readFileSync(join(process.cwd(), "src/client/src/components/shared.ts"), "utf8");
    expect(shared).toContain("padding: var(--pi-reading-edge)");
  });
});
