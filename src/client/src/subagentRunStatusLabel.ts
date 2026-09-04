import type { SessionSubagentRunInfo } from "../../shared/apiTypes";

type RunStatus = SessionSubagentRunInfo["status"];

const LABELS: Record<RunStatus, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  lost: "Lost",
  unknown: "Running",
};

const EXPLANATIONS: Record<RunStatus, string> = {
  running: "This run is writing output.",
  done: "This run reported that it finished.",
  failed: "This run reported a failure.",
  lost: "This run stopped writing without reporting, so its outcome is gone.",
  unknown: "This run has started but written nothing yet; the report lands when it finishes.",
};

export function subagentRunStatusLabel(status: RunStatus): string {
  return LABELS[status];
}

export function subagentRunStatusExplanation(status: RunStatus): string {
  return EXPLANATIONS[status];
}
