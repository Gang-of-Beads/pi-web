import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { busDeclarationsOf } from "./busDeclarations.js";
import { SessionExtensionBus } from "./sessionExtensionBus.js";

const STATES = "piweb:states:probe";
const running = [{ id: "runs", label: "2 runs", tone: "accent", busy: true, count: 2 }];

function watched(channels: Record<string, "state" | "event">) {
  const bus = new SessionExtensionBus();
  const warnings: string[] = [];
  const seen = { changes: 0, warnings };
  bus.watch(() => { seen.changes += 1; }, (message) => { seen.warnings.push(message); });
  bus.declare(new Map(Object.entries(channels).map(([channel, kind]) => [channel, { channel, kind, access: "own" as const }])));
  return { bus, seen };
}

describe("a session's extension bus", () => {
  it("still delivers every emit to the extensions listening, declared or not", () => {
    const { bus } = watched({});
    const heard: unknown[] = [];
    bus.bus.on("private:talk", (data) => { heard.push(data); });
    bus.bus.emit("private:talk", { n: 1 });
    expect(heard).toEqual([{ n: 1 }]);
  });

  it("keeps the last value of a declared state channel and says when it changed, once per change", () => {
    const { bus, seen } = watched({ [STATES]: "state" });
    bus.bus.emit(STATES, running);
    bus.bus.emit(STATES, running);
    expect({ states: bus.declaredStates(), changes: seen.changes }).toEqual({ states: [{ owner: "probe", ...running[0] }], changes: 1 });
    bus.bus.emit(STATES, []);
    expect({ states: bus.declaredStates(), changes: seen.changes }).toEqual({ states: [], changes: 2 });
  });

  it("keeps nothing of a channel nobody declared, nor of one declared as an event", () => {
    const { bus, seen } = watched({ "piweb:states:other": "event" });
    bus.bus.emit(STATES, running);
    bus.bus.emit("piweb:states:other", running);
    expect({ states: bus.declaredStates(), changes: seen.changes }).toEqual({ states: [], changes: 0 });
  });

  it("refuses what is not a list of states, keeps the last good value, and says so once", () => {
    const { bus, seen } = watched({ [STATES]: "state" });
    bus.bus.emit(STATES, running);
    bus.bus.emit(STATES, [{ id: "runs", label: "x", tone: "purple", busy: true }]);
    bus.bus.emit(STATES, "nonsense");
    expect({ states: bus.declaredStates().map((state) => state.label), warnings: seen.warnings.length }).toEqual({ states: ["2 runs"], warnings: 1 });
  });

  it("refuses a value over 64 KiB or with no JSON form, and forgets everything when the extensions load again", () => {
    const { bus, seen } = watched({ [STATES]: "state", "probe:big": "state" });
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    bus.bus.emit("probe:big", "x".repeat(70_000));
    bus.bus.emit("probe:big", cycle);
    bus.bus.emit(STATES, running);
    bus.forget();
    expect({ states: bus.declaredStates(), changes: seen.changes, warnings: seen.warnings.length }).toEqual({ states: [], changes: 2, warnings: 1 });
  });

  it("drops the value of a channel that is no longer declared", () => {
    const { bus, seen } = watched({ [STATES]: "state" });
    bus.bus.emit(STATES, running);
    bus.declare(new Map());
    expect({ states: bus.declaredStates(), changes: seen.changes }).toEqual({ states: [], changes: 2 });
  });
});

describe("the channels loaded extensions declare", () => {
  let root: string | undefined;
  afterEach(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }); });

  async function packageAt(name: string, piWeb: unknown): Promise<string> {
    root ??= await mkdtemp(join(tmpdir(), "pi-web-bus-"));
    const directory = join(root, name, "src");
    await mkdir(directory, { recursive: true });
    await writeFile(join(root, name, "package.json"), JSON.stringify({ name, piWeb }), "utf8");
    return join(directory, "index.ts");
  }

  it("are read from each extension's own package, the first to claim an owner keeping it", async () => {
    const first = await packageAt("first", { bus: { "probe:runs": { kind: "state" }, "piweb:states:probe": { kind: "state" } } });
    const second = await packageAt("second", { bus: { "probe:other": { kind: "event" }, "piweb:states:second": { kind: "state" }, "piweb:states:probe": { kind: "state" } } });
    const plain = await packageAt("plain", undefined);
    const declared = busDeclarationsOf([first, second, plain, first]);
    expect({ channels: [...declared.channels.keys()].sort(), problems: declared.problems.length }).toEqual({ channels: ["piweb:states:probe", "piweb:states:second", "probe:runs"], problems: 2 });
    expect(busDeclarationsOf(["<inline:probe>", "builtin:probe"])).toEqual({ channels: new Map(), problems: [] });
  });

  it("report a malformed block and carry nothing of that package", async () => {
    const bad = await packageAt("bad", { bus: { "pi:x": { kind: "state" } } });
    const declared = busDeclarationsOf([bad]);
    expect({ channels: declared.channels.size, problem: declared.problems[0]?.includes("reserved owner") }).toEqual({ channels: 0, problem: true });
  });
});
