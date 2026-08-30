import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { readWorkspaceGoals } from "./goalStore.js";
import type { GoalRecordSummary } from "../../shared/apiTypes.js";

const directories: string[] = [];

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "goal-store-"));
  directories.push(directory);
  return directory;
}

/** Write one goal record the way the extension lays it out: the JSON block first. */
async function writeGoal(root: string, id: string, overrides: Partial<GoalRecordSummary> = {}): Promise<void> {
  await mkdir(join(root, ".pi", "goals"), { recursive: true });
  const record = {
    id,
    objective: overrides.objective ?? `Goal ${id}`,
    status: overrides.status ?? "active",
    sisyphus: false,
    autoContinue: false,
    updatedAt: overrides.updatedAt,
    taskList: [],
  };
  await writeFile(join(root, ".pi", "goals", `${id}.md`), `${JSON.stringify(record)}\n`, "utf8");
}

describe("readWorkspaceGoals across roots", () => {
  // The extension records under the focused session's cwd; this reader used to
  // cover only the workspace root, so a goal written beside a session whose cwd
  // diverged was invisible and the panel claimed none existed.
  it("reads a goal that lives only under the focused session's cwd", async () => {
    const workspace = await scratch();
    const sessionCwd = await scratch();
    await writeGoal(sessionCwd, "session-goal");

    const response = await readWorkspaceGoals(workspace, { sessionCwd });

    expect(response.goals.map((goal) => goal.id)).toEqual(["session-goal"]);
    expect(response.goals[0]?.sourceRoot).toBe(sessionCwd);
    // The primary directory stays the workspace's: that is the root the panel
    // has always answered for.
    expect(response.directory).toBe(join(workspace, ".pi", "goals"));
  });

  it("lists a goal present in both roots once, from the workspace root", async () => {
    const workspace = await scratch();
    const sessionCwd = await scratch();
    await writeGoal(workspace, "shared", { objective: "the workspace copy" });
    await writeGoal(sessionCwd, "shared", { objective: "the session copy" });

    const response = await readWorkspaceGoals(workspace, { sessionCwd });

    expect(response.goals).toHaveLength(1);
    expect(response.goals[0]?.objective).toBe("the workspace copy");
    expect(response.goals[0]?.sourceRoot).toBe(workspace);
  });

  it("leaves sourceRoot unset when one root covered the read", async () => {
    const workspace = await scratch();
    await writeGoal(workspace, "workspace-goal");

    const withSession = await readWorkspaceGoals(workspace, { sessionCwd: workspace });
    const withoutSession = await readWorkspaceGoals(workspace);

    expect(withSession.goals[0]?.sourceRoot).toBeUndefined();
    expect(withoutSession.goals[0]?.sourceRoot).toBeUndefined();
  });
});
