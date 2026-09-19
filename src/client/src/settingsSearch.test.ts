import { describe, expect, it } from "vitest";
import { searchSettings } from "./settingsSearch";

const entries = [
  { id: "general", label: "General", detail: "Gateway + selected machine" },
  { id: "appearance", label: "Appearance", detail: "Theme and system preference" },
  { id: "sessiond", label: "Session daemon", detail: "Selected machine" },
  { id: "shortcuts", label: "Keyboard", detail: "Gateway shortcuts" },
];

const ids = (query: string) => searchSettings(entries, query).map((match) => match.id);

describe("searchSettings", () => {
  it("lists everything for an empty query", () => {
    expect(ids("")).toEqual(["general", "appearance", "sessiond", "shortcuts"]);
    expect(ids("   ")).toHaveLength(4);
  });

  it("finds a section by a piece of its name", () => {
    expect(ids("daemon")).toEqual(["sessiond"]);
    expect(ids("appear")).toEqual(["appearance"]);
  });

  it("forgives dropped letters", () => {
    expect(ids("sesdaemon")).toEqual(["sessiond"]);
    expect(ids("kybrd")).toEqual(["shortcuts"]);
  });

  it("matches the description when the name does not", () => {
    expect(ids("theme")).toEqual(["appearance"]);
    expect(ids("gateway")).toEqual(expect.arrayContaining(["general", "shortcuts"]));
  });

  it("ranks a name match above a description match", () => {
    expect(ids("session")[0]).toBe("sessiond");
  });

  it("answers nothing for a word that is in none of them", () => {
    expect(ids("bluetooth")).toEqual([]);
  });
});
