import { describe, expect, it } from "vitest";
import { queuedCommandDispatch, sessionCommandKind } from "./sessionCommandKind.js";

const session = {
  extensionRunner: { getRegisteredCommands: () => [{ invocationName: "goal" }] },
  promptTemplates: [{ name: "review" }],
  resourceLoader: { getSkills: () => ({ skills: [{ name: "probe" }] }) },
};

describe("what a slash text is to a session", () => {
  it("is a built-in only as pi reads one, then what the session registers, then a message", () => {
    expect(["/new", "/session extra", "/goal ship it", "/skill:probe now", "/review\tthis", "/skill:none", "/home/me/x.txt", "words"].map((text) => sessionCommandKind(session, text)))
      .toEqual(["builtin", "message", "extension", "resource", "resource", "message", "message", "message"]);
  });

  it("hands a queued entry on by what it is now, and refuses only a command that had to be an extension's", () => {
    expect({
      message: queuedCommandDispatch(session, { text: "/home/me/x.txt" }),
      extension: queuedCommandDispatch(session, { text: "/goal ship it", command: {} }),
      typedCommandFromAnOlderPage: queuedCommandDispatch(session, { text: "/home/me/x.txt", command: {} }),
      pluginCommandThatIsGone: queuedCommandDispatch(session, { text: "/gone now", command: { extensionOnly: true } }),
      pluginCommandThatIsASkill: queuedCommandDispatch(session, { text: "/skill:probe", command: { extensionOnly: true } }),
    }).toEqual({ message: "input", extension: "extension", typedCommandFromAnOlderPage: "input", pluginCommandThatIsGone: "refused", pluginCommandThatIsASkill: "refused" });
  });
});
