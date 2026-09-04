import { describe, expect, it } from "vitest";
import {
  InvalidPluginOperationError,
  parsePluginOperations,
  requirePluginOperation,
  UnknownPluginOperationError,
} from "./pluginOperations";

describe("parsing declared plugin operations", () => {
  it("accepts named handlers", async () => {
    const operations = parsePluginOperations({ "speech.token": () => ({ token: "t" }) });

    const handler = requirePluginOperation(operations, "speech.token");

    await expect(Promise.resolve(handler(undefined, { signal: new AbortController().signal }))).resolves.toEqual({ token: "t" });
  });

  it("treats a plugin with no operations as having none rather than as broken", () => {
    expect(parsePluginOperations(undefined)).toBeUndefined();
  });

  it("refuses a name that is not a plain operation name", () => {
    expect(() => parsePluginOperations({ "../escape": () => null })).toThrow(InvalidPluginOperationError);
    expect(() => parsePluginOperations({ "Speech Token": () => null })).toThrow(InvalidPluginOperationError);
    expect(() => parsePluginOperations({ "": () => null })).toThrow(InvalidPluginOperationError);
  });

  it("refuses a handler that is not callable", () => {
    expect(() => parsePluginOperations({ "speech.token": "nope" })).toThrow(InvalidPluginOperationError);
  });

  it("refuses an operations value that is not an object of handlers", () => {
    expect(() => parsePluginOperations([])).toThrow(InvalidPluginOperationError);
    expect(() => parsePluginOperations("speech")).toThrow(InvalidPluginOperationError);
  });

  it("names an undeclared operation instead of answering emptily", () => {
    const operations = parsePluginOperations({ "speech.token": () => null });

    expect(() => requirePluginOperation(operations, "speech.other")).toThrow(UnknownPluginOperationError);
    expect(() => requirePluginOperation(undefined, "speech.token")).toThrow(UnknownPluginOperationError);
  });

  it("does not let a plugin reach the prototype through an operation name", () => {
    const operations = parsePluginOperations({ "speech.token": () => null });

    expect(() => requirePluginOperation(operations, "constructor")).toThrow(UnknownPluginOperationError);
    expect(() => requirePluginOperation(operations, "__proto__")).toThrow(UnknownPluginOperationError);
  });
});
