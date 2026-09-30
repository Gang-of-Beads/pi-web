import type { SessionTarget } from "./sessionTarget";

/** The names a target's words need: the machine and the workspace it was asked in. */
export interface SessionTargetNames {
  readonly machine: string;
  readonly workspace: string;
}

/**
 * What the chat surface shows for a named session it cannot show
 * (state-diagram D8, "The target of a session link"; owner Q8). While nothing
 * has answered it says only that the session is loading; once there is an
 * answer it says what the answer proved, and offers the way back to the
 * workspace's sessions.
 */
export interface SessionTargetView {
  readonly role: "status" | "alert";
  readonly text: string;
  readonly wayBack: string | undefined;
}

type ShownTarget = Exclude<SessionTarget, { kind: "open" } | { kind: "archived" }>;

const LOADING = "Loading this session…";

const REFUSAL_WORDS = {
  "signed-out": (machine: string) => `${machine} asked you to sign in before it opens this session.`,
  forbidden: (machine: string) => `${machine} refused to open this session.`,
} satisfies Record<Extract<SessionTarget, { kind: "refused" }>["fact"], (machine: string) => string>;

const loading = (): Omit<SessionTargetView, "wayBack"> & { answered: false } => ({ role: "status", text: LOADING, answered: false });
const answered = (text: string): Omit<SessionTargetView, "wayBack"> & { answered: true } => ({ role: "alert", text, answered: true });

const WORDS = {
  asking: () => loading(),
  unknown: () => loading(),
  gone: (_target, names) => answered(`This session no longer exists on ${names.machine}.`),
  "not-listed": (_target, names) => answered(`This session isn't in ${names.workspace} on ${names.machine}.`),
  "folder-gone": () => answered("This session's folder no longer exists, so it cannot be opened."),
  refused: (target, names) => answered(target.kind === "refused" ? REFUSAL_WORDS[target.fact](names.machine) : `${names.machine} refused to open this session.`),
} satisfies Record<ShownTarget["kind"], (target: ShownTarget, names: SessionTargetNames) => Omit<SessionTargetView, "wayBack"> & { answered: boolean }>;

export function sessionTargetView(target: SessionTarget, names: SessionTargetNames): SessionTargetView | undefined {
  if (target.kind === "open" || target.kind === "archived") return undefined;
  const { answered: hasAnswer, ...words } = WORDS[target.kind](target, names);
  return { ...words, wayBack: hasAnswer ? `Go to ${names.workspace}'s sessions` : undefined };
}
