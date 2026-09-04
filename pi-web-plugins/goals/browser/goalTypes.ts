/**
 * The wire shape this plugin answers with.
 *
 * Declared here rather than imported from the host: the response is this
 * plugin's contract with whoever reads it, and a plugin that reached into the
 * host's own types would break the moment the host reorganized something it
 * never promised.
 */
export interface GoalTaskSummary {
  id: string;
  title: string;
  status: string;
  verificationContract?: string;
  subtasks?: GoalTaskSummary[];
}

export interface GoalRecordSummary {
  id: string;
  objective: string;
  /** Extension-owned lifecycle state, e.g. `active`, `paused`, `complete`. */
  status: string;
  /** Absolute path of the file this record was read from. */
  path: string;
  sisyphus: boolean;
  autoContinue: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** The task the agent reported working on; execution focus, not completion. */
  currentTaskId?: string;
  stopReason?: string;
  pauseReason?: string;
  verificationContract?: string;
  tokensUsed?: number;
  activeSeconds?: number;
  tasks: GoalTaskSummary[];
  /** Counts include nested subtasks, so a tree renders one honest ratio. */
  completedTaskCount: number;
  totalTaskCount: number;
  /**
   * Root this record was read from, set only when a read covered more than one
   * root (the workspace root plus a focused session's divergent cwd). Absent in
   * the single-root case so the common payload is unchanged.
   */
  sourceRoot?: string;
}

