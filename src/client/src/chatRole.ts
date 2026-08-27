export const ChatRole = {
  user: "user",
  assistant: "assistant",
  tool: "tool",
  system: "system",
  bash: "bash",
  skill: "skill",
} as const;

export type ChatRole = (typeof ChatRole)[keyof typeof ChatRole];
