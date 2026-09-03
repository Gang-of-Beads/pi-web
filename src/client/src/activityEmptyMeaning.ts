export type ActivityEmptyMeaning =
  | { kind: "session-busy-elsewhere"; text: string }
  | { kind: "nothing-tracked"; text: string };

export interface ActivityEmptyInputs {
  isStreaming: boolean;
  isBashRunning: boolean;
}

export function activityEmptyMeaning(inputs: ActivityEmptyInputs): ActivityEmptyMeaning {
  if (inputs.isBashRunning) {
    return { kind: "session-busy-elsewhere", text: "No agent runs or tasks. A command is running in this session." };
  }
  if (inputs.isStreaming) {
    return { kind: "session-busy-elsewhere", text: "No agent runs or tasks. The agent is working in this session." };
  }
  return { kind: "nothing-tracked", text: "No agent runs or tasks running right now." };
}
