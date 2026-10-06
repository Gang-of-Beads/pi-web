import { arrayOf, parseSessionInfo, parseWorkspace } from "../api/parsers";
import { durablePageStorage, evictOldestChatHistory, type HistoryStorage } from "../chatHistoryCache";
import { isRecord } from "../../../shared/unknownValues";
import type { SessionBoard, UnknownSource } from "./sessionBoard";

/**
 * The session board a machine last answered, kept in this browser so the list
 * draws at once on the next visit (docs/design/cached-first-and-motion.md).
 *
 * A cold load used to draw no rows until the board read landed, 1.6-1.8 s on
 * 8505 and a round trip more on a phone. The remembered board is drawn under
 * its own machine only and is replaced by the live read the moment it answers;
 * until then the board counts as unanswered, so no list claims to be empty
 * from it. It lives in localStorage beside the transcript cache and shares its
 * budget (owner, 2026-10-06): when the store is full the oldest transcript page
 * makes room. A board is kept whole or not at all - a trimmed one would draw a
 * list that was never true - and is dropped when it is older than a week, does
 * not parse, or was written by another shape of this record.
 */
export interface BoardMemory {
  recall(machineId: string): SessionBoard | undefined;
  remember(machineId: string, board: SessionBoard): void;
}

const KEY_PREFIX = "pi-web:session-board:v1:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The most one board may take of the shared store; the 166-session board on 8505 takes about 170 KB. */
const MAX_BOARD_CHARS = 1024 * 1024;
/** Writes are at most once a second per machine; a busy board changes far more often than that. */
const WRITE_INTERVAL_MS = 1000;

export interface BoardMemoryDependencies {
  storage?: () => HistoryStorage;
  makeRoom?: (storage: HistoryStorage) => boolean;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => void;
}

export function browserBoardMemory(deps: BoardMemoryDependencies = {}): BoardMemory {
  const storage = deps.storage ?? durablePageStorage;
  const makeRoom = deps.makeRoom ?? evictOldestChatHistory;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((callback, delayMs) => { globalThis.setTimeout(callback, delayMs); });
  const pending = new Map<string, SessionBoard>();
  const lastWriteAt = new Map<string, number>();

  const write = (machineId: string): void => {
    const board = pending.get(machineId);
    pending.delete(machineId);
    if (board === undefined) return;
    lastWriteAt.set(machineId, now());
    storeBoard(storage(), makeRoom, keyOf(machineId), JSON.stringify({ savedAt: now(), board }));
  };

  return {
    recall: (machineId) => recallBoard(storage(), keyOf(machineId), now()),
    remember: (machineId, board) => {
      const scheduled = pending.has(machineId);
      pending.set(machineId, board);
      if (scheduled) return;
      const wait = (lastWriteAt.get(machineId) ?? -Infinity) + WRITE_INTERVAL_MS - now();
      if (wait <= 0) {
        write(machineId);
        return;
      }
      setTimer(() => { write(machineId); }, wait);
    },
  };
}

function keyOf(machineId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(machineId)}`;
}

function recallBoard(storage: HistoryStorage, key: string, now: number): SessionBoard | undefined {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return undefined;
    const board = parseRemembered(JSON.parse(raw), now);
    if (board === undefined) storage.removeItem(key);
    return board;
  } catch {
    forget(storage, key);
    return undefined;
  }
}

function parseRemembered(value: unknown, now: number): SessionBoard | undefined {
  if (!isRecord(value) || typeof value["savedAt"] !== "number" || !isRecord(value["board"])) return undefined;
  if (now - value["savedAt"] > MAX_AGE_MS) return undefined;
  const board = value["board"];
  const pinnedElsewhere = board["pinnedElsewhere"] === undefined ? [] : arrayOf(parseSessionInfo)(board["pinnedElsewhere"]);
  return {
    sessions: arrayOf(parseSessionInfo)(board["sessions"]),
    workspaces: arrayOf(parseWorkspace)(board["workspaces"]),
    unknownSources: arrayOf(parseUnknownSource)(board["unknownSources"]),
    ...(pinnedElsewhere.length === 0 ? {} : { pinnedElsewhere }),
  };
}

/** One reader per kind of unknown source; a kind not listed is not a source this record can hold. */
const UNKNOWN_SOURCE_READERS = new Map<unknown, (record: Record<string, unknown>) => UnknownSource>([
  ["project", (record) => ({ kind: "project", projectId: sourceName(record, "projectId") })],
  ["workspace", (record) => ({ kind: "workspace", path: sourceName(record, "path") })],
  ["pin", (record) => ({ kind: "pin", sessionId: sourceName(record, "sessionId") })],
]);

function parseUnknownSource(value: unknown): UnknownSource {
  if (!isRecord(value)) throw new Error("Expected an unknown source");
  const read = UNKNOWN_SOURCE_READERS.get(value["kind"]);
  if (read === undefined) throw new Error("Expected an unknown source kind");
  return read(value);
}

function sourceName(record: Record<string, unknown>, field: string): string {
  const name = record[field];
  if (typeof name !== "string") throw new Error(`Expected an unknown source's ${field}`);
  return name;
}

function storeBoard(storage: HistoryStorage, makeRoom: (storage: HistoryStorage) => boolean, key: string, payload: string): void {
  if (payload.length > MAX_BOARD_CHARS) {
    forget(storage, key);
    return;
  }
  for (;;) {
    try {
      storage.setItem(key, payload);
      return;
    } catch {
      if (!makeRoom(storage)) return;
    }
  }
}

function forget(storage: HistoryStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}
