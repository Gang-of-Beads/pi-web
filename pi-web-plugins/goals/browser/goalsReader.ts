import type { GoalRecordSummary } from "./goalTypes.js";
import { failedGoals, loadedGoals, loadingGoals, unloadedGoals, type GoalsLoad } from "./goalsLoad.js";

export type CallOperation = (operation: string, input?: unknown) => Promise<unknown>;

/**
 * Reads this plugin's own goals through its own operation.
 *
 * The reader owns the slot rather than handing raw promises to a view: a read
 * that is overtaken by a newer workspace must not land, and a failure must
 * leave a failed slot rather than an empty one that reads as "no goals".
 */
export class GoalsReader {
  private slot: GoalsLoad<GoalRecordSummary> = unloadedGoals<GoalRecordSummary>();
  private inFlight = 0;

  constructor(
    private readonly callOperation: CallOperation,
    private readonly onChange: () => void,
  ) {}

  current(): GoalsLoad<GoalRecordSummary> {
    return this.slot;
  }

  async read(workspacePath: string, sessionCwd?: string): Promise<void> {
    const attempt = ++this.inFlight;
    this.publish(loadingGoals(workspacePath, this.slot));
    try {
      const answer = await this.callOperation("goals.read", { workspacePath, ...(sessionCwd === undefined ? {} : { sessionCwd }) });
      if (attempt !== this.inFlight) return;
      this.publish(loadedGoals(workspacePath, parseGoals(answer)));
    } catch (error) {
      if (attempt !== this.inFlight) return;
      this.publish(failedGoals(workspacePath, error instanceof Error ? error.message : String(error), this.slot));
    }
  }

  private publish(next: GoalsLoad<GoalRecordSummary>): void {
    this.slot = next;
    this.onChange();
  }
}

function parseGoals(answer: unknown): GoalRecordSummary[] {
  if (typeof answer !== "object" || answer === null) throw new Error("The goals answer was not an object");
  const goals: unknown = Reflect.get(answer, "goals");
  if (!Array.isArray(goals)) throw new Error("The goals answer carried no goals");
  return goals.filter(isGoalRecord);
}

function isGoalRecord(value: unknown): value is GoalRecordSummary {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "id") === "string";
}
