import type { GoalRecordSummary, GoalTaskSummary } from "../../../shared/apiTypes.js";

/**
 * Reading goal records written by the `pi-goal-x` extension.
 *
 * A goal file is a Markdown document whose *leading* block is the complete
 * record as pretty-printed JSON, followed by a human-readable rendering:
 *
 * ```
 * {
 *   "version": 3,
 *   "id": "...",
 *   ...
 * }
 *
 * # Goal Prompt
 * ...
 * ```
 *
 * Only the JSON block is authoritative here; the prose below it is a
 * projection of the same fields and is never parsed. The extension owns the
 * format, so this reader is deliberately permissive: unknown fields are
 * ignored and a record missing anything required is skipped rather than
 * failing the whole listing.
 */

/** Guard against a runaway or truncated file consuming the parse. */
const MAX_GOAL_FILE_BYTES = 512 * 1024;

/**
 * Extract the leading JSON object of a goal file.
 *
 * Brace counting is string- and escape-aware so a brace inside an objective
 * (`"ship {this}"`) cannot end the block early. Returns undefined when the
 * content does not begin with a JSON object, which is the expected outcome for
 * a file caught mid-write.
 */
export function extractGoalJsonBlock(content: string): string | undefined {
  const start = content.indexOf("{");
  if (start === -1) return undefined;
  // Anything before the object other than whitespace means this is not a goal
  // file laid out as expected.
  if (content.slice(0, start).trim() !== "") return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return undefined;
}

/**
 * Parse one goal file into the summary the browser renders.
 *
 * Returns undefined for content that is not a usable record: a partial write,
 * a foreign file that happens to live in the directory, or a record without
 * the identity fields the UI needs. Callers skip those rather than surfacing
 * an error, because a goal directory is written concurrently by the extension
 * and a transient unparseable read is normal.
 */
export function parseGoalFile(content: string, filePath: string): GoalRecordSummary | undefined {
  if (content.length > MAX_GOAL_FILE_BYTES) return undefined;
  const block = extractGoalJsonBlock(content);
  if (block === undefined) return undefined;

  let record: unknown;
  try {
    record = JSON.parse(block);
  } catch {
    return undefined;
  }
  const fields = asRecord(record);
  if (fields === undefined) return undefined;

  const id = optionalString(fields["id"]);
  const objective = optionalString(fields["objective"]);
  if (id === undefined || objective === undefined) return undefined;

  const tasks = parseTasks(fields["taskList"]);
  return {
    id,
    objective,
    status: optionalString(fields["status"]) ?? "unknown",
    path: filePath,
    sisyphus: fields["sisyphus"] === true,
    autoContinue: fields["autoContinue"] === true,
    ...optional("createdAt", optionalString(fields["createdAt"])),
    ...optional("updatedAt", optionalString(fields["updatedAt"])),
    ...optional("currentTaskId", optionalString(fields["currentTaskId"])),
    ...optional("stopReason", optionalString(fields["stopReason"])),
    ...optional("pauseReason", optionalString(fields["pauseReason"])),
    ...optional("verificationContract", optionalString(fields["verificationContract"])),
    ...optional("tokensUsed", optionalNonNegativeNumber(usageField(fields["usage"], "tokensUsed"))),
    ...optional("activeSeconds", optionalNonNegativeNumber(usageField(fields["usage"], "activeSeconds"))),
    tasks,
    completedTaskCount: countTasks(tasks, (task) => task.status === "complete"),
    totalTaskCount: countTasks(tasks, () => true),
  };
}

/**
 * Order goals for display: unfinished work first, then most recently updated.
 * A completed goal is still listed — it is the record of what was achieved —
 * but never above a goal that still needs attention.
 */
export function sortGoalSummaries(goals: readonly GoalRecordSummary[]): GoalRecordSummary[] {
  return [...goals].sort((left, right) => {
    const leftDone = isFinishedStatus(left.status);
    const rightDone = isFinishedStatus(right.status);
    if (leftDone !== rightDone) return leftDone ? 1 : -1;
    return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
  });
}

function isFinishedStatus(status: string): boolean {
  return status === "complete" || status === "completed" || status === "abandoned";
}

function parseTasks(value: unknown): GoalTaskSummary[] {
  const taskList = asRecord(value);
  if (taskList === undefined) return [];
  const list = taskList["tasks"];
  if (!Array.isArray(list)) return [];
  const tasks: GoalTaskSummary[] = [];
  for (const entry of list) {
    const task = parseTask(entry);
    if (task !== undefined) tasks.push(task);
  }
  return tasks;
}

function parseTask(value: unknown): GoalTaskSummary | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const id = optionalString(fields["id"]);
  const title = optionalString(fields["title"]);
  if (id === undefined || title === undefined) return undefined;
  const subtasks = Array.isArray(fields["subtasks"])
    ? fields["subtasks"].map(parseTask).filter((task): task is GoalTaskSummary => task !== undefined)
    : [];
  return {
    id,
    title,
    status: optionalString(fields["status"]) ?? "pending",
    ...optional("verificationContract", optionalString(fields["verificationContract"])),
    ...(subtasks.length === 0 ? {} : { subtasks }),
  };
}

function countTasks(tasks: readonly GoalTaskSummary[], predicate: (task: GoalTaskSummary) => boolean): number {
  let count = 0;
  for (const task of tasks) {
    if (predicate(task)) count += 1;
    if (task.subtasks !== undefined) count += countTasks(task.subtasks, predicate);
  }
  return count;
}

function usageField(usage: unknown, key: string): unknown {
  return asRecord(usage)?.[key];
}

/** Narrow an unknown to a plain object without asserting a shape onto it. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  const result: Partial<Record<K, V>> = {};
  if (value !== undefined) result[key] = value;
  return result;
}
