import { describe, expect, it } from "vitest";
import { parseSessionBoardAnswer, UnexpectedBoardAnswer } from "./parsers";

/**
 * P4 slice a: the board answer carries each source's raw answer, parsed here with the parsers the
 * per-source reads use. An entry that does not parse is a source that did not answer, never an
 * empty one; an answer of the wrong shape is a machine that does not know the route.
 */
describe("parseSessionBoardAnswer", () => {
  const workspace = { id: "w1", projectId: "alpha", path: "/alpha", label: "main", isMain: true, effectiveConfig: {} };
  const session = { id: "a1", cwd: "/alpha", path: "/alpha/a1.jsonl", created: "2026-09-01", modified: "2026-09-01", messageCount: 1, firstMessage: "hi" };

  it("parses each source, and keeps an entry that does not parse as unknown", () => {
    const parsed = parseSessionBoardAnswer({
      projects: [
        { projectId: "alpha", resolution: { status: "provider", projectId: "alpha", ownerPluginId: "git", workspaces: [workspace], diagnostics: [] } },
        { projectId: "beta", unknown: true },
        { projectId: "gamma", resolution: { status: "provider", projectId: "other", ownerPluginId: "git", workspaces: [{ ...workspace, projectId: "other" }], diagnostics: [] } },
        { projectId: "delta", resolution: "not a resolution" },
      ],
      listings: [
        { cwd: "/alpha", sessions: [session] },
        { cwd: "/alpha-wt", unknown: true },
        { cwd: "/broken", sessions: [{ id: 7 }] },
      ],
    });

    expect(parsed).toEqual({
      projects: [
        { projectId: "alpha", workspaces: [workspace] },
        { projectId: "beta", unknown: true },
        { projectId: "gamma", unknown: true },
        { projectId: "delta", unknown: true },
      ],
      listings: [
        { cwd: "/alpha", sessions: [session] },
        { cwd: "/alpha-wt", unknown: true },
        { cwd: "/broken", unknown: true },
      ],
    });
  });

  it("refuses an answer that is not a board", () => {
    const shapes = ["<!doctype html>", [], { projects: [] }, { listings: [] }, { projects: [{}], listings: [] }, { projects: [], listings: [{ sessions: [] }] }];
    expect(shapes.map((shape) => { try { parseSessionBoardAnswer(shape); return "parsed"; } catch (error) { return error instanceof UnexpectedBoardAnswer ? "refused" : "other"; } }))
      .toEqual(["refused", "refused", "refused", "refused", "refused", "refused"]);
  });
});
