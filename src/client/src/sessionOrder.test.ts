import { describe, expect, it } from "vitest";
import { sessionRowKind, shownArchived, withProjectGone } from "./sessionOrder";

describe("a session no listed project holds", () => {
  const marked = (cwds: readonly string[], roots: readonly string[]): string[] => withProjectGone(cwds.map((cwd) => ({ cwd })), roots).filter((session) => session.projectMissing === true).map((session) => session.cwd);

  it("is one outside every project folder and workspace, whatever the separator or its trailing one", () => {
    const roots = ["/work/pai", "/work/peasy-collect/", "C:\\Users\\me\\p\\"];
    expect(marked(["/work/pai", "/work/pai/sub", "/work/peasy-collect", "C:\\Users\\me\\p\\src", "/work/pai-archive", "/work", "/tmp/scratch"], roots)).toEqual(["/work/pai-archive", "/work", "/tmp/scratch"]);
  });

  it("is nobody while the projects have not arrived: an empty list is not \"no project\"", () => {
    const sessions = [{ cwd: "/work/pai" }];
    expect(withProjectGone(sessions, [])).toBe(sessions);
  });

  it("is shown in Archived without being archived, and still opens: its folder is there", () => {
    expect({ kind: sessionRowKind({ projectMissing: true }), archived: shownArchived({ projectMissing: true }) }).toEqual({ kind: "project-gone", archived: true });
  });

  it("gives way to a folder that is gone and to a real archive", () => {
    expect([sessionRowKind({ projectMissing: true, cwdMissing: true }), sessionRowKind({ projectMissing: true, archived: true }), sessionRowKind({})]).toEqual(["folder-gone", "archived", "live"]);
  });
});
