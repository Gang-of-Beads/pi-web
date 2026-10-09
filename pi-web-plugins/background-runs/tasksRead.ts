import type { TaskInput, TasksRead } from "./backgroundTaskRows.js";

/** The session a read is for: its working directory and transcript, which the server reads from. */
export interface TaskScope {
  readonly cwd: string;
  readonly sessionFile: string;
}

export interface TasksView {
  readonly tasks: readonly TaskInput[];
  readonly read: TasksRead;
}

const UNREAD: TasksView = { tasks: [], read: "unread" };

/**
 * The panel's read of one session's tasks.
 *
 * A read is asked when the session on screen changes or when one of the facts that move with its
 * tasks does (the caller's key: the session's background run count and whether its turn runs). A
 * list belongs to the session it was
 * read for and never shows under another; only the latest read may land; a failed read keeps the
 * list it had for the same session and says the read failed.
 */
export class TasksReader {
  private sessionFile: string | undefined;
  private key: string | undefined;
  private view: TasksView = UNREAD;
  private issued = 0;

  constructor(
    private readonly ask: (scope: TaskScope) => Promise<unknown>,
    private readonly changed: () => void,
  ) {}

  /** The session on screen and its key; reads when either is new. */
  follow(scope: TaskScope, key: string): void {
    if (this.sessionFile !== scope.sessionFile) {
      this.sessionFile = scope.sessionFile;
      this.view = UNREAD;
      this.key = undefined;
    }
    if (this.key === key) return;
    this.key = key;
    this.read(scope);
  }

  /** Something outside the key changed (the session's work settled): the next follow reads. */
  forget(): void {
    this.key = undefined;
  }

  viewFor(sessionFile: string): TasksView {
    return this.sessionFile === sessionFile ? this.view : UNREAD;
  }

  private read(scope: TaskScope): void {
    this.issued += 1;
    const seq = this.issued;
    const current = (): boolean => seq === this.issued && scope.sessionFile === this.sessionFile;
    this.ask(scope).then(
      (answer) => {
        if (!current()) return;
        const tasks = tasksFrom(answer);
        this.view = tasks === undefined ? { tasks: this.view.tasks, read: "failed" } : { tasks, read: "read" };
        this.changed();
      },
      () => {
        if (!current()) return;
        this.view = { tasks: this.view.tasks, read: "failed" };
        this.changed();
      },
    );
  }
}

/** The tasks in a `tasks.list` answer; undefined when the answer is not one, which is a failed read. */
function tasksFrom(answer: unknown): readonly TaskInput[] | undefined {
  if (!isRecord(answer) || answer["known"] !== true || !Array.isArray(answer["tasks"])) return undefined;
  return answer["tasks"].flatMap((entry: unknown) => {
    if (!isRecord(entry)) return [];
    const { id, name, status, startedAt, durationMs, exitCode } = entry;
    if (typeof id !== "string" || typeof name !== "string" || typeof status !== "string") return [];
    return [{
      id,
      name,
      status,
      ...(typeof startedAt === "string" ? { startedAt } : {}),
      ...(typeof durationMs === "number" ? { durationMs } : {}),
      ...(typeof exitCode === "number" ? { exitCode } : {}),
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
