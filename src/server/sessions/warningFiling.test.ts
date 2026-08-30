import { describe, expect, it } from "vitest";
import type { SessionWarning } from "../../shared/apiTypes";
import { takeUnfiledWarnings, warningIdentity } from "./warningFiling";

function warning(over: Partial<SessionWarning> = {}): SessionWarning {
  return { severity: "warning", message: "skill collision: openspec-apply-change", ...over };
}

describe("filing a warning exactly once per occurrence", () => {
  /**
   * Status assembly runs on every poll; without the memo, the same warning
   * would deposit a fresh drawer row each pass - the flood the owner's screen
   * showed as cards would just move into the drawer.
   */
  it("files a warning on first sight and never again on repeat passes", () => {
    const memo = new Set<string>();
    expect(takeUnfiledWarnings(memo, [warning()])).toHaveLength(1);
    expect(takeUnfiledWarnings(memo, [warning()])).toHaveLength(0);
    expect(takeUnfiledWarnings(memo, [warning()])).toHaveLength(0);
  });

  it("treats different content as different occurrences", () => {
    const memo = new Set<string>();
    takeUnfiledWarnings(memo, [warning()]);
    const next = takeUnfiledWarnings(memo, [warning(), warning({ message: "another skill collided" }), warning({ severity: "error" })]);
    expect(next.map((w) => w.message.slice(0, 7))).toEqual(["another", "skill c"]);
  });

  /** Identity reads the full content, so truncation for display cannot collide. */
  it("computes identity from severity, source, path and full message", () => {
    expect(warningIdentity(warning({ source: "runtime", path: "/a" })))
      .not.toBe(warningIdentity(warning({ source: "runtime", path: "/b" })));
  });

  /** Eviction may re-file - a duplicate record, never a lost warning. */
  it("caps the memo by evicting the oldest identities first", () => {
    const memo = new Set<string>();
    for (let index = 0; index < 140; index += 1) {
      takeUnfiledWarnings(memo, [warning({ message: `w${String(index)}` })]);
    }
    expect(memo.size).toBeLessThanOrEqual(128);
    expect(takeUnfiledWarnings(memo, [warning({ message: "w0" })])).toHaveLength(1);
    expect(takeUnfiledWarnings(memo, [warning({ message: "w139" })])).toHaveLength(0);
  });
});
