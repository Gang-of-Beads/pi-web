import { describe, expect, it } from "vitest";
import { derivedTags, navigateModel, type NavigateInput } from "./navigateModel";
import type { SessionInfo } from "./api";

const session = (id: string, cwd: string, name?: string): SessionInfo => ({
  id,
  path: `/store/${id}.jsonl`,
  cwd,
  persisted: true,
  created: "2026-09-01T00:00:00.000Z",
  modified: "2026-09-01T00:00:00.000Z",
  messageCount: 2,
  firstMessage: "",
  ...(name === undefined ? {} : { name }),
});

const base: NavigateInput = {
  scope: { machineId: "local", projectId: undefined, folderPath: undefined, sessionId: undefined },
  machines: [{ id: "local", name: "Local" }, { id: "pi", name: "pi" }],
  projects: [{ id: "p1", name: "pi-web", path: "/repos/pi-web" }, { id: "p2", name: "trade", path: "/repos/trade" }],
  folders: [
    { id: "w1", label: "main", path: "/repos/pi-web", projectId: "p1" },
    { id: "w2", label: "probe", path: "/repos/pi-web-probe", projectId: "p1" },
    { id: "w3", label: "main", path: "/repos/trade", projectId: "p2" },
  ],
  sessions: [session("a", "/repos/pi-web", "fix login"), session("b", "/repos/pi-web-probe", "probe run"), session("c", "/repos/trade", "ledger")],
  pinned: [],
  waitingSessionIds: new Set(),
  activeSessionIds: new Set(),
  pinnedSessionIds: new Set(),
  query: "",
};

const sectionIds = (input: NavigateInput) => navigateModel(input).sections.map((section) => section.id);

describe("navigateModel", () => {
  it("offers projects and every session while the path is empty", () => {
    const model = navigateModel(base);
    expect(model.nextLevel).toBe("project");
    expect(sectionIds(base)).toEqual(["recent", "choices"]);
    expect(model.sections.find((section) => section.id === "recent")?.rows).toHaveLength(3);
    expect(model.sections.find((section) => section.id === "choices")?.choices.map((choice) => choice.label)).toEqual(["pi-web", "trade"]);
  });

  it("offers a chosen project's folders and only its sessions", () => {
    const model = navigateModel({ ...base, scope: { machineId: "local", projectId: "p1", folderPath: undefined, sessionId: undefined } });
    expect(model.nextLevel).toBe("folder");
    expect(model.sections.find((section) => section.id === "recent")?.rows.map((row) => row.session.id)).toEqual(["a", "b"]);
    expect(model.sections.find((section) => section.id === "choices")?.choices.map((choice) => choice.label)).toEqual(["main", "probe"]);
  });

  it("ends the path at a folder and lists that folder's sessions", () => {
    const model = navigateModel({ ...base, scope: { machineId: "local", projectId: "p1", folderPath: "/repos/pi-web-probe", sessionId: undefined } });
    expect(model.nextLevel).toBe("folder");
    expect(model.sections.map((section) => section.id)).toEqual(["recent", "choices"]);
    expect(model.sections[0]?.rows.map((row) => row.session.id)).toEqual(["b"]);
    expect(model.sections[1]?.choices.filter((choice) => choice.current).map((choice) => choice.label)).toEqual(["probe"]);
  });

  it("keeps every session listed while a chosen project's folders are unknown", () => {
    const model = navigateModel({ ...base, folders: [], scope: { machineId: "local", projectId: "p1", folderPath: undefined, sessionId: undefined } });
    expect(model.sections.find((section) => section.id === "recent")?.rows).toHaveLength(3);
  });

  it("separates what waits for the reader from what is merely running", () => {
    const model = navigateModel({ ...base, waitingSessionIds: new Set(["a"]), activeSessionIds: new Set(["a", "b"]) });
    expect(sectionIds({ ...base, waitingSessionIds: new Set(["a"]), activeSessionIds: new Set(["a", "b"]) })).toEqual(["waiting", "running", "recent", "choices"]);
    expect(model.sections[0]?.rows.map((row) => row.session.id)).toEqual(["a"]);
    expect(model.sections[1]?.rows.map((row) => row.session.id)).toEqual(["b"]);
  });

  it("marks the session the reader already has open", () => {
    const model = navigateModel({ ...base, scope: { ...base.scope, sessionId: "b" } });
    const rows = model.sections.flatMap((section) => section.rows);
    expect(rows.filter((row) => row.current).map((row) => row.session.id)).toEqual(["b"]);
  });

  it("does not mark another machine's session with the same id", () => {
    const model = navigateModel({ ...base, scope: { ...base.scope, sessionId: "z" }, pinned: [{ session: session("z", "/elsewhere"), machineId: "pi" }] });
    const rows = model.sections.flatMap((section) => section.rows);
    expect(rows.filter((row) => row.current)).toEqual([]);
  });

  it("lists pinned sessions from other machines above the local ones", () => {
    const model = navigateModel({ ...base, pinned: [{ session: session("z", "/elsewhere", "remote work"), machineId: "pi" }] });
    expect(model.sections[0]?.id).toBe("pinned");
    expect(model.sections[0]?.rows[0]?.machineId).toBe("pi");
  });

  it("searches names, paths and tags, and reads #tag as a tag", () => {
    const withState = { ...base, waitingSessionIds: new Set(["a"]) };
    expect(navigateModel({ ...withState, query: "ledger" }).matchCount).toBe(1);
    expect(navigateModel({ ...withState, query: "#waiting" }).sections[0]?.rows.map((row) => row.session.id)).toEqual(["a"]);
    expect(navigateModel({ ...withState, query: "#pi-web" }).matchCount).toBe(2);
    expect(navigateModel({ ...withState, query: "#nothing" }).matchCount).toBe(0);
  });

  it("merges manual tags with the derived ones", () => {
    const model = navigateModel({ ...base, manualTags: { a: ["Release"] }, query: "#release" });
    expect(model.matchCount).toBe(1);
  });

  it("says state, size and folder under the name instead of a row of hashes", () => {
    const model = navigateModel({ ...base, waitingSessionIds: new Set(["a"]) });
    const rows = model.sections.flatMap((section) => section.rows);
    expect(rows.find((row) => row.session.id === "a")?.detail).toBe("waiting for you · 2 messages · main");
    expect(rows.find((row) => row.session.id === "c")?.detail).toBe("2 messages · main");
  });

  it("derives machine, project, folder and state tags", () => {
    expect(derivedTags(session("a", "/repos/pi-web"), { ...base, waitingSessionIds: new Set(["a"]) }, "local")).toEqual(["local", "main", "pi-web", "waiting"]);
  });

  it("offers machines as the only level when there are no projects to group by", () => {
    expect(navigateModel({ ...base, projects: [] }).nextLevel).toBe("machine");
  });
});
