import { browserLocalStorage } from "./browserLocalStorage";
import { newClientMessageId } from "./messageDelivery";

/**
 * This browser's standing with each session's machine (docs/design/message-states.md, "Order").
 *
 * The browser is one device with a fixed id, so a reload, or closing the page and coming back,
 * keeps sending what it left. The machine numbers a device's operations by where it last said the
 * device stands: every batch is numbered from `ackedThrough`, the highest number the machine has
 * confirmed, recorded from its answers - so a batch nobody answered is numbered the same when it
 * is sent again, and the machine recognises what it already ran.
 */

const DEVICE_KEY = "pi-web:device-id";
const ACKED_PREFIX = "pi-web:acked-through:";

/** Minted once per browser profile; every tab of the profile is this device. */
export function deviceId(storage = browserLocalStorage()): string {
  const held = storage?.getItem(DEVICE_KEY);
  if (held !== undefined && held !== null && held !== "") return held;
  const minted = `device-${newClientMessageId()}`;
  storage?.setItem(DEVICE_KEY, minted);
  return minted;
}

/** The highest number the machine has confirmed for this device on this session. */
export function ackedThrough(sessionKey: string, storage = browserLocalStorage()): number {
  const held = Number(storage?.getItem(`${ACKED_PREFIX}${sessionKey}`) ?? "0");
  return Number.isSafeInteger(held) && held >= 0 ? held : 0;
}

/** Record where the machine says this device stands; it only moves forward. */
export function confirmThrough(sessionKey: string, appliedThrough: number, storage = browserLocalStorage()): void {
  if (appliedThrough <= ackedThrough(sessionKey, storage)) return;
  try {
    storage?.setItem(`${ACKED_PREFIX}${sessionKey}`, String(appliedThrough));
  } catch {
    return;
  }
}

/** A deleted session's standing goes with it. */
export function forgetAckedThrough(sessionKey: string, storage = browserLocalStorage()): void {
  storage?.removeItem(`${ACKED_PREFIX}${sessionKey}`);
}

/** A draft's standing goes with its outbox to the session's own id. */
export function moveAckedThrough(fromSessionKey: string, toSessionKey: string, storage = browserLocalStorage()): void {
  if (fromSessionKey === toSessionKey) return;
  const raw = storage?.getItem(`${ACKED_PREFIX}${fromSessionKey}`);
  if (raw === undefined || raw === null) return;
  storage?.setItem(`${ACKED_PREFIX}${toSessionKey}`, raw);
  storage?.removeItem(`${ACKED_PREFIX}${fromSessionKey}`);
}
