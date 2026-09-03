import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COARSE_OR_MOBILE_MEDIA_QUERY,
  DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY,
  MOBILE_NAVIGATION_MAX_PX,
  MOBILE_NAVIGATION_MEDIA_QUERY,
  NARROW_CHAT_MAX_PX,
  NARROW_PHONE_MAX_PX,
  SHORT_VIEWPORT_MAX_PX,
  WORKSPACE_SIDE_BY_SIDE_MIN_PX,
} from "./breakpoints";
import { MOBILE_PROMPT_ENTER_MEDIA_QUERY } from "./promptEnterBehavior";
import { TERMINAL_SOFT_KEYS_DEFAULT_ENVIRONMENT_MEDIA } from "./terminalSoftKeysPreference";

/**
 * One breakpoint authority. The parity review found the 760px line written in
 * three mechanisms, a 420 beside a 430 dividing nothing, and two modals going
 * full-bleed 80px apart - copies with no link to a source, each free to drift.
 * Every viewport media query in client code must use a named line; a new
 * number fails here with the file that introduced it. Container queries are
 * content-local by design and exempt.
 */
const ALLOWED_WIDTHS = new Set([
  NARROW_PHONE_MAX_PX,
  NARROW_CHAT_MAX_PX,
  MOBILE_NAVIGATION_MAX_PX,
  WORKSPACE_SIDE_BY_SIDE_MIN_PX,
  WORKSPACE_SIDE_BY_SIDE_MIN_PX - 1,
]);
const ALLOWED_HEIGHTS = new Set([SHORT_VIEWPORT_MAX_PX]);

function clientSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      clientSourceFiles(path, out);
      continue;
    }
    const isSource = (path.endsWith(".ts") || path.endsWith(".html") || path.endsWith(".css")) && !path.endsWith(".test.ts") && !path.endsWith(".testSupport.ts");
    if (isSource) out.push(path);
  }
  return out;
}

describe("the breakpoint authority", () => {
  it("is the only source of viewport media-query numbers in client code", () => {
    const offenders: string[] = [];
    for (const path of clientSourceFiles(join(process.cwd(), "src/client"))) {
      const source = readFileSync(path, "utf-8");
      for (const match of source.matchAll(/@media[^{;\n]*/g)) {
        for (const dimension of match[0].matchAll(/(min|max)-(width|height):\s*(\d+)px/g)) {
          const value = Number(dimension[3]);
          const allowed = dimension[2] === "width" ? ALLOWED_WIDTHS : ALLOWED_HEIGHTS;
          if (!allowed.has(value)) offenders.push(`${path.slice(path.indexOf("src/client"))}: ${match[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("derives every TypeScript media-query constant from the named lines", () => {
    expect(MOBILE_NAVIGATION_MEDIA_QUERY).toBe(`(max-width: ${String(MOBILE_NAVIGATION_MAX_PX)}px)`);
    expect(DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY).toBe(`(min-width: ${String(WORKSPACE_SIDE_BY_SIDE_MIN_PX)}px)`);
    expect(COARSE_OR_MOBILE_MEDIA_QUERY).toBe(`(pointer: coarse), (max-width: ${String(MOBILE_NAVIGATION_MAX_PX)}px)`);
    // The two preference modules and the shell controller consume the derived
    // strings, so their copies cannot drift from the mobile line.
    expect(MOBILE_PROMPT_ENTER_MEDIA_QUERY).toBe(COARSE_OR_MOBILE_MEDIA_QUERY);
    expect(TERMINAL_SOFT_KEYS_DEFAULT_ENVIRONMENT_MEDIA).toBe(COARSE_OR_MOBILE_MEDIA_QUERY);
  });

  it("keeps the two layout lines apart and ordered", () => {
    expect(NARROW_PHONE_MAX_PX).toBeLessThan(NARROW_CHAT_MAX_PX);
    expect(NARROW_CHAT_MAX_PX).toBeLessThan(MOBILE_NAVIGATION_MAX_PX);
    expect(MOBILE_NAVIGATION_MAX_PX).toBeLessThan(WORKSPACE_SIDE_BY_SIDE_MIN_PX);
  });
});
