import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveWorkspaceGoal, GoalArchiveError } from "./goalArchive.js";

/**
 * The archive protocol, which exists because a paused goal never leaves the
 * panel on its own and the extension's own clear command refuses without a
 * confirmable UI. Every assertion here is one of the extension's own rules:
 * the prose body carries the objective, the pool snapshot is a cache that lies
 * if left behind, and the lock is how two processes stay out of each other's
 * way.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }); }));
});

async function workspace(record: Record<string, unknown> = {}, prose = "\n\n# Goal Prompt\n\nShip the thing.\n"): Promise<{ path: string; goals: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-goal-"));
  roots.push(root);
  const path = join(root, "workspace");
  const goals = join(path, ".pi", "goals");
  const home = join(root, "home");
  await mkdir(goals, { recursive: true });
  await mkdir(join(home, ".pi"), { recursive: true });
  const header = { version: 3, id: "goal-1", status: "paused", revision: 7, activePath: ".pi/goals/active_goal_1.md", ...record };
  await writeFile(join(goals, "active_goal_1.md"), `${JSON.stringify(header, undefined, 2)}${prose}`, "utf8");
  await writeFile(join(home, ".pi", ".goals-pool-snapshot.json"), JSON.stringify({ goals: [header] }), "utf8");
  return { path, goals, home };
}

async function archivedRecord(goals: string): Promise<{ name: string; header: Record<string, unknown>; body: string }> {
  const names = await readdir(join(goals, "archived"));
  const name = names[0];
  if (name === undefined) throw new Error("Expected an archived goal file");
  const content = await readFile(join(goals, "archived", name), "utf8");
  const end = content.lastIndexOf("}", content.indexOf("\n\n#"));
  const header: unknown = JSON.parse(content.slice(0, end + 1));
  if (typeof header !== "object" || header === null) throw new Error("Expected an object header");
  return { name, header: { ...header }, body: content.slice(end + 1) };
}

describe("archiveWorkspaceGoal", () => {
  it("moves the record into archived/ and removes the active one", async () => {
    const { path, goals, home } = await workspace();

    const result = await archiveWorkspaceGoal(path, "goal-1", { home });

    expect(result.alreadyArchived).toBe(false);
    expect(await readdir(goals)).not.toContain("active_goal_1.md");
    const archived = await archivedRecord(goals);
    expect(archived.name).toMatch(/^goal_\d{14}_goal-1\.md$/u);
  });

  it("keeps the prose body, where the objective actually lives", async () => {
    const { path, goals, home } = await workspace();

    await archiveWorkspaceGoal(path, "goal-1", { home });

    expect((await archivedRecord(goals)).body).toContain("Ship the thing.");
  });

  it("advances the revision and records why it stopped", async () => {
    const { path, goals, home } = await workspace();

    await archiveWorkspaceGoal(path, "goal-1", { home });

    const { header } = await archivedRecord(goals);
    expect(header["revision"]).toBe(8);
    expect(header["stopReason"]).toBe("user");
    expect(header["status"]).toBe("paused");
    expect(header["activePath"]).toBeUndefined();
    expect(header["archivedPath"]).toContain("archived/");
  });

  it("does not demote a completed goal to paused", async () => {
    const { path, goals, home } = await workspace({ status: "complete" });

    await archiveWorkspaceGoal(path, "goal-1", { home });

    expect((await archivedRecord(goals)).header["status"]).toBe("complete");
  });

  it("appends one ledger event", async () => {
    const { path, goals, home } = await workspace();

    await archiveWorkspaceGoal(path, "goal-1", { home });

    const lines = (await readFile(join(goals, "goal_events.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ type: "goal_archived", goalId: "goal-1", source: "pi-web" });
  });

  it("drops the pool snapshot, which would otherwise keep claiming the goal is open", async () => {
    const { path, home } = await workspace();

    await archiveWorkspaceGoal(path, "goal-1", { home });

    await expect(readFile(join(home, ".pi", ".goals-pool-snapshot.json"), "utf8")).rejects.toThrow();
  });

  it("reports that a running agent may still recreate the record", async () => {
    const { path, home } = await workspace();

    expect((await archiveWorkspaceGoal(path, "goal-1", { home })).agentMayRecreate).toBe(true);
  });

  it("is idempotent: archiving an absent goal is not an error", async () => {
    const { path, home } = await workspace();

    await archiveWorkspaceGoal(path, "goal-1", { home });
    const second = await archiveWorkspaceGoal(path, "goal-1", { home });

    expect(second.alreadyArchived).toBe(true);
  });

  it("releases the lock it took", async () => {
    const { path, goals, home } = await workspace();

    await archiveWorkspaceGoal(path, "goal-1", { home });

    expect(await readdir(join(goals, ".locks"))).toEqual([]);
  });

  it("refuses while another process holds the lock", async () => {
    const { path, goals, home } = await workspace();
    await mkdir(join(goals, ".locks"), { recursive: true });
    await writeFile(join(goals, ".locks", "goal-1.lock"), JSON.stringify({ pid: 1, startedAt: new Date().toISOString() }), "utf8");

    await expect(archiveWorkspaceGoal(path, "goal-1", { home })).rejects.toBeInstanceOf(GoalArchiveError);
    // The record is untouched: a refusal must not half-archive.
    expect(await readdir(goals)).toContain("active_goal_1.md");
  });

  it("takes over a lock left behind by a process that died", async () => {
    const { path, goals, home } = await workspace();
    await mkdir(join(goals, ".locks"), { recursive: true });
    await writeFile(join(goals, ".locks", "goal-1.lock"), "{}", "utf8");
    const later = new Date(Date.now() + 60_000);

    const result = await archiveWorkspaceGoal(path, "goal-1", { home, now: () => later });

    expect(result.alreadyArchived).toBe(false);
  });

  it("cannot be walked out of the goals directory by its id", async () => {
    // The id only ever selects a record already in the directory, and the file
    // name derived from it is sanitised, so a traversal attempt matches nothing
    // and touches nothing.
    const { path, goals, home } = await workspace();

    const result = await archiveWorkspaceGoal(path, "../../etc/passwd", { home });

    expect(result.alreadyArchived).toBe(true);
    expect(await readdir(goals)).toContain("active_goal_1.md");
    expect(await readdir(goals)).not.toContain("archived");
  });

  it("rejects an empty or oversized id before touching the directory", async () => {
    const { path, home } = await workspace();

    await expect(archiveWorkspaceGoal(path, "", { home })).rejects.toBeInstanceOf(GoalArchiveError);
    await expect(archiveWorkspaceGoal(path, "g".repeat(200), { home })).rejects.toBeInstanceOf(GoalArchiveError);
  });
});
