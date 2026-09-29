import { describe, expect, it } from "vitest";
import { routedWorkspaceTool } from "./routedWorkspaceTool";

describe("the tool a restored route puts in the panel", () => {
  it("is the route's tool, the view's tool when the route names none, and otherwise stays", () => {
    expect({
      named: routedWorkspaceTool("git:git", "subagents:workspace.subagents", "files:files"),
      viewOnly: routedWorkspaceTool(undefined, "subagents:workspace.subagents", "files:files"),
      chat: routedWorkspaceTool(undefined, "chat", "files:files"),
      navigation: routedWorkspaceTool(undefined, "navigation", "git:git"),
    }).toEqual({
      named: "git:git",
      viewOnly: "subagents:workspace.subagents",
      chat: "files:files",
      navigation: "git:git",
    });
  });
});
