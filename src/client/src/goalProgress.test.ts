import { describe, expect, it } from "vitest";
import type { GoalRecordSummary, GoalTaskSummary } from "./api";
import {
  findCurrentTask,
  flattenGoalTasks,
  formatGoalTokens,
  goalProgressFraction,
  goalProgressLabel,
  goalStatusLabel,
  isGoalBlocked,
  isGoalFinished,
} from "./goalProgress";

describe("goalProgressFraction", () => {
  it("reports the completed share", () => {
    expect(goalProgressFraction({ completedTaskCount: 3, totalTaskCount: 9 })).toBeCloseTo(1 / 3);
  });

  it("reports zero for a goal with no tasks rather than a full bar", () => {
    // "Nothing to do" is not "everything done"; a full bar would misreport an
    // active objective as finished.
    expect(goalProgressFraction({ completedTaskCount: 0, totalTaskCount: 0 })).toBe(0);
  });

  it("clamps inconsistent counts into range", () => {
    expect(goalProgressFraction({ completedTaskCount: 12, totalTaskCount: 9 })).toBe(1);
    expect(goalProgressFraction({ completedTaskCount: -1, totalTaskCount: 9 })).toBe(0);
  });
});

describe("goalProgressLabel", () => {
  it("shows a ratio when there are tasks", () => {
    expect(goalProgressLabel({ completedTaskCount: 3, totalTaskCount: 9 })).toBe("3/9");
  });

  it("says so when a goal has no task list", () => {
    expect(goalProgressLabel({ completedTaskCount: 0, totalTaskCount: 0 })).toBe("No tasks");
  });
});

describe("goalStatusLabel", () => {
  it("names the statuses the extension writes", () => {
    expect(goalStatusLabel("active")).toBe("Active");
    expect(goalStatusLabel("paused")).toBe("Paused");
    expect(goalStatusLabel("budget_limited")).toBe("Budget reached");
  });

  it("passes an unknown status through instead of hiding it", () => {
    expect(goalStatusLabel("awaiting_review")).toBe("awaiting review");
  });
});

describe("goal lifecycle predicates", () => {
  it("separates finished from blocked", () => {
    expect(isGoalFinished({ status: "complete" })).toBe(true);
    expect(isGoalFinished({ status: "paused" })).toBe(false);
    expect(isGoalBlocked({ status: "paused" })).toBe(true);
    expect(isGoalBlocked({ status: "budget_limited" })).toBe(true);
    expect(isGoalBlocked({ status: "active" })).toBe(false);
  });
});

describe("findCurrentTask", () => {
  it("finds the focused task at the top level", () => {
    expect(findCurrentTask(goal())?.title).toBe("Top one");
  });

  it("finds a focused subtask", () => {
    expect(findCurrentTask({ ...goal(), currentTaskId: "t2b" })?.title).toBe("Nested B");
  });

  it("returns nothing when no task is focused", () => {
    const withoutFocus = { ...goal() };
    delete withoutFocus.currentTaskId;
    expect(findCurrentTask(withoutFocus)).toBeUndefined();
  });

  it("returns nothing when the focused id no longer exists", () => {
    expect(findCurrentTask({ ...goal(), currentTaskId: "removed" })).toBeUndefined();
  });
});

describe("flattenGoalTasks", () => {
  it("emits a depth-first order carrying indentation depth", () => {
    expect(flattenGoalTasks(goal().tasks).map((row) => [row.task.id, row.depth])).toEqual([
      ["t1", 0],
      ["t2", 0],
      ["t2a", 1],
      ["t2b", 1],
    ]);
  });
});

describe("formatGoalTokens", () => {
  it("compacts large counts", () => {
    expect(formatGoalTokens(1_142_125)).toBe("1.1M tokens");
    expect(formatGoalTokens(24_000)).toBe("24k tokens");
    expect(formatGoalTokens(900)).toBe("900 tokens");
  });

  it("omits an absent or empty count", () => {
    expect(formatGoalTokens(undefined)).toBeUndefined();
    expect(formatGoalTokens(0)).toBeUndefined();
  });
});

function goal(): GoalRecordSummary {
  const tasks: GoalTaskSummary[] = [
    { id: "t1", title: "Top one", status: "complete" },
    {
      id: "t2",
      title: "Top two",
      status: "pending",
      subtasks: [
        { id: "t2a", title: "Nested A", status: "complete" },
        { id: "t2b", title: "Nested B", status: "pending" },
      ],
    },
  ];
  return {
    id: "g1",
    objective: "Ship it",
    status: "active",
    path: "/repo/.pi/goals/g1.md",
    sisyphus: false,
    autoContinue: true,
    currentTaskId: "t1",
    tasks,
    completedTaskCount: 2,
    totalTaskCount: 4,
  };
}
