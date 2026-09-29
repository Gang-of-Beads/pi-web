import { describe, expect, it } from "vitest";
import { routedWorkspaceTool } from "./routedWorkspaceTool";

describe("the tool a restored route puts in the panel", () => {
  it("is the view's tool when the view is one, else the route's tool, else the one it had", () => {
    expect({
      disagreeing: routedWorkspaceTool("git:git", "subagents:workspace.subagents", "files:files"),
      viewOnly: routedWorkspaceTool(undefined, "subagents:workspace.subagents", "files:files"),
      chatWithTool: routedWorkspaceTool("git:git", "chat", "files:files"),
      chat: routedWorkspaceTool(undefined, "chat", "files:files"),
      navigation: routedWorkspaceTool(undefined, "navigation", "git:git"),
    }).toEqual({
      disagreeing: "subagents:workspace.subagents",
      viewOnly: "subagents:workspace.subagents",
      chatWithTool: "git:git",
      chat: "files:files",
      navigation: "git:git",
    });
  });
});
