import { describe, expect, it } from "vitest";
import { followedAfter, runsActivityOf, runsPollingDecision, type FollowedActivity, type RunsActivity } from "./runsPolling.js";

const FOLLOWED: readonly FollowedActivity[] = ["unfollowed", "unknown", "idle", "working"];
const NEXT: readonly RunsActivity[] = ["unknown", "idle", "working"];

describe("when the subagents panel reads its runs again (object model §4.3, idle traffic)", () => {
  it("reads the activity from the host's status of the session it shows, and an absent status as unknown", () => {
    expect([
      runsActivityOf({ isStreaming: true }),
      runsActivityOf({ isStreaming: false, backgroundRunCount: 2 }),
      runsActivityOf({ isStreaming: false, backgroundRunCount: 0 }),
      runsActivityOf({ isStreaming: false }),
      runsActivityOf(undefined),
    ]).toEqual(["working", "working", "idle", "idle", "unknown"]);
  });

  it("polls only while the session works, reads on following and on each edge of work, and takes an unknown status as no news", () => {
    const table = Object.fromEntries(FOLLOWED.flatMap((previous) => NEXT.map((next) => {
      const { read, poll } = runsPollingDecision(previous, next);
      return [`${previous} -> ${next}`, `${read ? "read" : "-"} ${poll ? "poll" : "quiet"} => ${followedAfter(previous, next)}`];
    })));

    expect(table).toEqual({
      "unfollowed -> unknown": "read quiet => unknown",
      "unfollowed -> idle": "read quiet => idle",
      "unfollowed -> working": "read poll => working",
      "unknown -> unknown": "- quiet => unknown",
      "unknown -> idle": "- quiet => idle",
      "unknown -> working": "- poll => working",
      "idle -> unknown": "- quiet => idle",
      "idle -> idle": "- quiet => idle",
      "idle -> working": "read poll => working",
      "working -> unknown": "- poll => working",
      "working -> idle": "read quiet => idle",
      "working -> working": "- poll => working",
    });
  });
});
