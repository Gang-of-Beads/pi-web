import type { SessionRef } from "../../../shared/apiTypes";
import { resolveAppWebSocketUrl } from "../appUrl";

/** A session's stream; `quietSeconds` names the page's quiet window, so the daemon heartbeats a quiet socket within it. */
export function sessionEvents(session: SessionRef, machineId = "local", quietSeconds?: number): WebSocket {
  const params = new URLSearchParams({ cwd: session.cwd });
  if (quietSeconds !== undefined) params.set("quiet", String(quietSeconds));
  return new WebSocket(resolveAppWebSocketUrl(`${machinePrefix(machineId)}/sessions/${encodeURIComponent(session.id)}/events?${params.toString()}`));
}

export function globalSessionEvents(machineId = "local"): WebSocket {
  return new WebSocket(resolveAppWebSocketUrl(`${machinePrefix(machineId)}/sessions/events`));
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

/** A machine's announcements; `quietSeconds` names the page's quiet window, as a session's stream does. */
export function realtimeEvents(machineId = "local", quietSeconds?: number): WebSocket {
  const query = quietSeconds === undefined ? "" : `?${new URLSearchParams({ quiet: String(quietSeconds) }).toString()}`;
  return new WebSocket(resolveAppWebSocketUrl(`${machinePrefix(machineId)}/events${query}`));
}

function machinePrefix(machineId: string): string {
  return `api/machines/${encodeURIComponent(machineId)}`;
}
