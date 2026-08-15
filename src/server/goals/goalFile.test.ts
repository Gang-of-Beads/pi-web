import { describe, expect, it } from "vitest";
import { extractGoalJsonBlock, parseGoalFile, sortGoalSummaries } from "./goalFile";

const RECORD = {
  version: 3,
  id: "msure99o-a1kk9q",
  objective: "Ship the mobile work",
  status: "paused",
  autoContinue: false,
  usage: { tokensUsed: 1142125, activeSeconds: 49 },
  sisyphus: false,
  createdAt: "2026-08-15T19:18:35.628Z",
  updatedAt: "2026-08-15T19:19:47.890Z",
  currentTaskId: "task-1",
  stopReason: "user",
  taskList: {
    tasks: [
      { id: "task-1", title: "Compress the header", status: "complete", verificationContract: "Chat height grows" },
      { id: "task-2", title: "Global switcher", status: "pending" },
    ],
    blockCompletion: true,
  },
};

function goalFile(record: unknown = RECORD): string {
  return `${JSON.stringify(record, null, 2)}\n\n# Goal Prompt\n\nShip the mobile work\n\n## Tasks\n\n- [x] task-1\n`;
}

describe("extractGoalJsonBlock", () => {
  it("returns the leading object and stops at its closing brace", () => {
    const block = extractGoalJsonBlock(goalFile());
    expect(block?.startsWith("{")).toBe(true);
    expect(block?.endsWith("}")).toBe(true);
    expect(block).not.toContain("# Goal Prompt");
  });

  it("is not fooled by braces inside strings", () => {
    const block = extractGoalJsonBlock(`{"objective":"ship {this} thing","id":"g1"}\n\n# Goal Prompt\n`);
    expect(block).toBe(`{"objective":"ship {this} thing","id":"g1"}`);
  });

  it("is not fooled by an escaped quote before a brace", () => {
    const block = extractGoalJsonBlock(`{"objective":"say \\" then }","id":"g1"}\ntail`);
    expect(block).toBe(`{"objective":"say \\" then }","id":"g1"}`);
  });

  it("rejects content that does not start with an object", () => {
    expect(extractGoalJsonBlock("# Goal Prompt\n\n{\"id\":\"g1\"}")).toBeUndefined();
  });

  it("rejects an unterminated object from a partial write", () => {
    expect(extractGoalJsonBlock('{\n  "id": "g1",\n  "objective": "half')).toBeUndefined();
  });
});

describe("parseGoalFile", () => {
  it("reads identity, lifecycle, usage, and task counts", () => {
    const goal = parseGoalFile(goalFile(), "/repo/.pi/goals/active_goal_x.md");

    expect(goal).toMatchObject({
      id: "msure99o-a1kk9q",
      objective: "Ship the mobile work",
      status: "paused",
      path: "/repo/.pi/goals/active_goal_x.md",
      sisyphus: false,
      autoContinue: false,
      currentTaskId: "task-1",
      stopReason: "user",
      tokensUsed: 1142125,
      activeSeconds: 49,
      completedTaskCount: 1,
      totalTaskCount: 2,
    });
    expect(goal?.tasks[0]).toMatchObject({ id: "task-1", status: "complete", verificationContract: "Chat height grows" });
  });

  it("counts nested subtasks in the ratio", () => {
    const nested = {
      ...RECORD,
      taskList: {
        tasks: [
          {
            id: "task-1",
            title: "Parent",
            status: "pending",
            subtasks: [
              { id: "task-1a", title: "Child A", status: "complete" },
              { id: "task-1b", title: "Child B", status: "pending" },
            ],
          },
        ],
      },
    };
    const goal = parseGoalFile(goalFile(nested), "/repo/.pi/goals/g.md");

    expect(goal?.totalTaskCount).toBe(3);
    expect(goal?.completedTaskCount).toBe(1);
    expect(goal?.tasks[0]?.subtasks).toHaveLength(2);
  });

  it("keeps an unrecognised status verbatim rather than guessing", () => {
    const goal = parseGoalFile(goalFile({ ...RECORD, status: "budget_limited" }), "/repo/g.md");
    expect(goal?.status).toBe("budget_limited");
  });

  it("defaults a record with no task list to an empty, honest ratio", () => {
    const goal = parseGoalFile(goalFile({ id: "g1", objective: "Bare goal" }), "/repo/g.md");
    expect(goal).toMatchObject({ tasks: [], completedTaskCount: 0, totalTaskCount: 0, status: "unknown" });
  });

  it("skips a record without the identity fields the UI needs", () => {
    expect(parseGoalFile(goalFile({ objective: "No id" }), "/repo/g.md")).toBeUndefined();
    expect(parseGoalFile(goalFile({ id: "g1" }), "/repo/g.md")).toBeUndefined();
  });

  it("skips a file caught mid-write instead of throwing", () => {
    expect(parseGoalFile('{\n  "id": "g1",\n  "objec', "/repo/g.md")).toBeUndefined();
  });

  it("skips an implausibly large file", () => {
    expect(parseGoalFile(`{"id":"g1","objective":"${"x".repeat(600_000)}"}`, "/repo/g.md")).toBeUndefined();
  });
});

describe("sortGoalSummaries", () => {
  it("puts unfinished goals first, then most recently updated", () => {
    const goals = [
      summary("done", "complete", "2026-08-15T23:00:00.000Z"),
      summary("older", "active", "2026-08-15T20:00:00.000Z"),
      summary("newer", "paused", "2026-08-15T22:00:00.000Z"),
    ];

    expect(sortGoalSummaries(goals).map((goal) => goal.id)).toEqual(["newer", "older", "done"]);
  });

  it("does not mutate its input", () => {
    const goals = [summary("a", "complete", "2026-01-01T00:00:00.000Z"), summary("b", "active", "2026-01-02T00:00:00.000Z")];
    sortGoalSummaries(goals);
    expect(goals.map((goal) => goal.id)).toEqual(["a", "b"]);
  });
});

function summary(id: string, status: string, updatedAt: string) {
  return {
    id,
    objective: id,
    status,
    path: `/repo/${id}.md`,
    sisyphus: false,
    autoContinue: false,
    updatedAt,
    tasks: [],
    completedTaskCount: 0,
    totalTaskCount: 0,
  };
}
