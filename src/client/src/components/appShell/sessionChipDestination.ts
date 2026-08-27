/**
 * A breadcrumb goes to what it names. The session breadcrumb names the
 * session, so from anywhere but its conversation it returns there; from the
 * conversation there is nowhere closer to go, so it offers the other sessions.
 *
 * Before this, every view listed the other sessions, and opening Goals, Files
 * or a terminal left no way back to the conversation at all.
 */
export function sessionChipDestination(view: string): "conversation" | "sessions" {
  return view === "chat" ? "sessions" : "conversation";
}
