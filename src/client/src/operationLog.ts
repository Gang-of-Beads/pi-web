import { browserLocalStorage } from "./browserLocalStorage";
import { newClientMessageId } from "./messageDelivery";

/**
 * This device's numbering of what it asks a session to do (docs/design/message-states.md,
 * "Order"). Every message and every take-back gets the next number for its session when it is
 * written, and keeps it through every resend. The machine applies one device's operations in
 * number order and refuses one whose predecessor has not arrived, so what the reader sent first
 * runs first however the network delivers the requests.
 *
 * The device sends only the head of its outbox, and everything below the head is done -
 * answered, or ended on this device (a command it ran itself). So each request says it follows
 * everything before it (`ackedThrough` is its own number less one), and a machine that lost its
 * record of this device starts from there.
 */
export interface SequencedOperation {
  readonly deviceId: string;
  readonly seq: number;
  readonly ackedThrough: number;
}


const DEVICE_KEY = "pi-web:device-id";
const LOG_PREFIX = "pi-web:operation-log:";

/** Minted once per browser profile; tabs of one profile share it, and the outbox with it. */
export function deviceId(storage = browserLocalStorage()): string {
  const held = storage?.getItem(DEVICE_KEY);
  if (held !== undefined && held !== null && held !== "") return held;
  const minted = `device-${newClientMessageId()}`;
  storage?.setItem(DEVICE_KEY, minted);
  return minted;
}

function nextOf(sessionKey: string, storage: Storage | undefined): number {
  const held = Number(storage?.getItem(`${LOG_PREFIX}${sessionKey}`) ?? "1");
  return Number.isSafeInteger(held) && held >= 1 ? held : 1;
}

/** The number the next operation written for this session takes. */
export function claimSequence(sessionKey: string, storage = browserLocalStorage()): number {
  const next = nextOf(sessionKey, storage);
  storage?.setItem(`${LOG_PREFIX}${sessionKey}`, String(next + 1));
  return next;
}

/** What a request for this operation carries. */
export function sequenceFor(seq: number, storage = browserLocalStorage()): SequencedOperation {
  return { deviceId: deviceId(storage), seq, ackedThrough: seq - 1 };
}

/**
 * A session started on this device gets its machine id once it exists: its log goes with its
 * outbox, so the numbers its first messages took are the ones the machine sees first.
 */
export function moveOperationLog(fromSessionKey: string, toSessionKey: string, storage = browserLocalStorage()): void {
  if (fromSessionKey === toSessionKey) return;
  const raw = storage?.getItem(`${LOG_PREFIX}${fromSessionKey}`);
  if (raw === undefined || raw === null) return;
  storage?.setItem(`${LOG_PREFIX}${toSessionKey}`, raw);
  storage?.removeItem(`${LOG_PREFIX}${fromSessionKey}`);
}
