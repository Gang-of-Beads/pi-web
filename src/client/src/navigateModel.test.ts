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
    expect(sectionIds(base)).toEqual(["recent", "choices", "choices"]);
    expect(model.sections.find((section) => section.id === "recent")?.rows).toHaveLength(3);
    expect(model.sections.filter((section) => section.id === "choices").flatMap((section) => section.choices).filter((choice) => choice.level === "project").map((choice) => choice.label)).toEqual(["pi-web", "trade"]);
  });

  it("lists a chosen project's sessions across all of its folders", () => {
    const model = navigateModel({ ...base, scope: { machineId: "local", projectId: "p1", folderPath: undefined, sessionId: undefined } });
    expect(model.nextLevel).toBe("project");
    expect(model.sections.find((section) => section.id === "recent")?.rows.map((row) => row.session.id)).toEqual(["a", "b"]);
  });

  it("keeps every session listed while a chosen project's folders are unknown", () => {
    const model = navigateModel({ ...base, folders: [], scope: { machineId: "local", projectId: "p1", folderPath: undefined, sessionId: undefined } });
    expect(model.sections.find((section) => section.id === "recent")?.rows).toHaveLength(3);
  });

  it("separates what waits for the reader from what is merely running", () => {
    const model = navigateModel({ ...base, waitingSessionIds: new Set(["a"]), activeSessionIds: new Set(["a", "b"]) });
    expect(sectionIds({ ...base, waitingSessionIds: new Set(["a"]), activeSessionIds: new Set(["a", "b"]) })).toEqual(["waiting", "running", "recent", "choices", "choices"]);
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

  it("offers machines even while a project is the next level", () => {
    // Asking for Machines from inside a project answered "nothing to choose"
    // while two machines sat in the same input.
    const model = navigateModel({ ...base, machines: [{ id: "local", name: "local" }, { id: "work", name: "work" }] });
    const machines = model.sections.flatMap((section) => section.choices).filter((choice) => choice.level === "machine");
    expect(machines.map((choice) => choice.label)).toEqual(["local", "work"]);
  });

  it("marks what each session is doing", () => {
    const model = navigateModel({ ...base, waitingSessionIds: new Set(["a"]), activeSessionIds: new Set(["a", "b"]) });
    const states = new Map(model.sections.flatMap((section) => section.rows).map((row) => [row.session.id, row.state]));
    expect(states.get("a")).toBe("waiting");
    expect(states.get("b")).toBe("working");
    expect(states.get("c")).toBe("idle");
  });
});

/**
 * Owner's rule: a project's board shows that project's pins; the machine-wide
 * quick-access board shows them all. Standing in a project and being shown
 * another project's pins read as the global page under a project's name.
 */
describe("pins under a narrowed path", () => {
  const local = session("a", "/repos/pi-web", "fix login");
  const other = session("c", "/repos/trade", "ledger");
  const pinnedBoth = [{ session: local, machineId: "local" }, { session: other, machineId: "local" }];

  it("lists only the pins the path contains", () => {
    const model = navigateModel({
      ...base,
      scope: { ...base.scope, projectId: "p1" },
      pinned: pinnedBoth,
      pinnedSessionIds: new Set(["a", "c"]),
    });

    const rows = model.sections.find((section) => section.id === "pinned")?.rows ?? [];
    expect(rows.map((row) => row.session.id)).toEqual(["a"]);
  });

  it("keeps every pin when the path is the whole machine", () => {
    const model = navigateModel({ ...base, pinned: pinnedBoth, pinnedSessionIds: new Set(["a", "c"]) });

    const rows = model.sections.find((section) => section.id === "pinned")?.rows ?? [];
    expect(rows.map((row) => row.session.id)).toEqual(["a", "c"]);
  });

  it("does not hide pins while the folder list is unread", () => {
    const model = navigateModel({
      ...base,
      folders: [],
      scope: { ...base.scope, projectId: "p1" },
      pinned: pinnedBoth,
      pinnedSessionIds: new Set(["a", "c"]),
    });

    const rows = model.sections.find((section) => section.id === "pinned")?.rows ?? [];
    expect(rows.map((row) => row.session.id), "an unread folder list is not an empty project").toEqual(["a", "c"]);
  });
});

/**
 * Owner report from the phone: a pinned session that was also working drew a
 * row in both sections, and the open-session highlight appeared on both.
 */
describe("one session, one row", () => {
  it("does not repeat a pinned session under Waiting or Working", () => {
    const busy = session("a", "/repos/pi-web", "fix login");
    const model = navigateModel({
      ...base,
      pinned: [{ session: busy, machineId: "local" }],
      pinnedSessionIds: new Set(["a"]),
      activeSessionIds: new Set(["a"]),
      waitingSessionIds: new Set(["a"]),
    });

    const ids = model.sections.flatMap((section) => section.rows.map((row) => row.session.id));
    expect(ids.filter((id) => id === "a").length).toBe(1);
    expect(model.sections.find((section) => section.id === "pinned")?.rows[0]?.session.id).toBe("a");
  });

  it("still lists an unpinned working session under Working", () => {
    const model = navigateModel({ ...base, activeSessionIds: new Set(["b"]) });
    expect(model.sections.find((section) => section.id === "running")?.rows.map((row) => row.session.id)).toEqual(["b"]);
  });
});
