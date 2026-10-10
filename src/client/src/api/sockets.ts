import type { SessionRef } from "../../../shared/apiTypes";
import { resolveAppWebSocketUrl } from "../appUrl";
import { STATUS_DELTA_QUERY } from "../../../shared/statusChanges";

/**
 * A session's stream; `quietSeconds` names the page's quiet window, so the daemon heartbeats a
 * quiet socket within it. It asks for statuses as what changed (shared/statusChanges.ts).
 */
export function sessionEvents(session: SessionRef, machineId = "local", quietSeconds?: number): WebSocket {
  const params = new URLSearchParams({ cwd: session.cwd, [STATUS_DELTA_QUERY.name]: STATUS_DELTA_QUERY.value });
  if (quietSeconds !== undefined) params.set("quiet", String(quietSeconds));
  return new WebSocket(resolveAppWebSocketUrl(`${machinePrefix(machineId)}/sessions/${encodeURIComponent(session.id)}/events?${params.toString()}`));
}

export function terminalSocket(projectId: string, workspaceId: string, terminalId: string, initialSize?: { cols: number; rows: number }, machineId = "local"): WebSocket {
  const sizeQuery = initialSize === undefined ? "" : `?${new URLSearchParams({ cols: String(initialSize.cols), rows: String(initialSize.rows) }).toString()}`;
  return new WebSocket(resolveAppWebSocketUrl(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(terminalId)}/socket${sizeQuery}`));
}

/** A machine terminal's stream (machineTerminalRoutes.ts): the shell in the machine's home folder. */
export function machineTerminalSocket(terminalId: string, initialSize?: { cols: number; rows: number }, machineId = "local"): WebSocket {
  const sizeQuery = initialSize === undefined ? "" : `?${new URLSearchParams({ cols: String(initialSize.cols), rows: String(initialSize.rows) }).toString()}`;
  return new WebSocket(resolveAppWebSocketUrl(`${machinePrefix(machineId)}/terminals/${encodeURIComponent(terminalId)}/socket${sizeQuery}`));
}

/** A machine's announcements; `quietSeconds` names the page's quiet window and statuses come as what changed, as on a session's stream. */
export function realtimeEvents(machineId = "local", quietSeconds?: number): WebSocket {
  const params = new URLSearchParams({ [STATUS_DELTA_QUERY.name]: STATUS_DELTA_QUERY.value });
  if (quietSeconds !== undefined) params.set("quiet", String(quietSeconds));
  return new WebSocket(resolveAppWebSocketUrl(`${machinePrefix(machineId)}/events?${params.toString()}`));
}

function machinePrefix(machineId: string): string {
  return `api/machines/${encodeURIComponent(machineId)}`;
}
