import { describe, expect, it } from "vitest";
import { builtinCommandOf } from "./builtinSlashCommands";

describe("the built-in a typed text is", () => {
  const read = (text: string): string => { const command = builtinCommandOf(text); return command === undefined ? "message" : `${command.name}(${command.rest})`; };

  it("is pi's own reading: the bare name, or the name and words for a command that takes them", () => {
    expect(["/model", "/model gpt x", "/login openai", " /new ", "/compact keep the plan"].map(read)).toEqual(["model()", "model(gpt x)", "login(openai)", "new()", "compact(keep the plan)"]);
  });

  it("is a message for everything else, which pi then runs, expands or sends to the model", () => {
    expect(["/home/me/notes.txt", "/nosuchcmd hello", "/session extra", "/logout openai", "/skill:review this", "/", "//x", "/NEW", "/model\ngpt", "plain words", "!ls"].map(read)).toEqual(Array.from({ length: 11 }, () => "message"));
  });
});
