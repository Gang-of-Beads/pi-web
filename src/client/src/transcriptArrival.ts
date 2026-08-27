import type { ChatLine } from "./components/shared";
import { ChatRole } from "./chatRole";
import { indexOfIdentity, messageIdentity } from "./messageIdentity";
import { carryDeliveryForward } from "./messageDelivery";
import { messageText } from "./chatTranscript";

export interface Arrival {
  readonly transcript: readonly ChatLine[];
  readonly lines: readonly ChatLine[];
  readonly clientMessageId: string | undefined;
}

/** What an arriving message turns out to be, relative to what is already shown. */
export type ArrivalOutcome =
  | { kind: "ignore" }
  | { kind: "replace"; at: number; line: ChatLine; rest: readonly ChatLine[] }
  | { kind: "place" };

type ArrivalRule = (arrival: Arrival) => ArrivalOutcome | undefined;

/**
 * The committed copy of a message this client sent optimistically. It carries
 * the delivery state forward rather than appearing beside its own echo.
 */
const supersedesOwnEcho: ArrivalRule = ({ transcript, lines }) => {
  const committed = lines[0];
  if (committed?.role !== ChatRole.user) return undefined;
  const text = messageText(committed);
  if (text === "") return undefined;
  const at = transcript.findIndex((line) => line.role === ChatRole.user && line.meta?.echo === true && messageText(line) === text);
  const previous = at === -1 ? undefined : transcript[at];
  if (previous === undefined) return undefined;
  return { kind: "replace", at, line: carryDeliveryForward(previous, committed), rest: lines.slice(1) };
};

/** A message this client is already tracking by correlation id. */
const alreadyTrackedById: ArrivalRule = ({ transcript, clientMessageId }) => {
  if (clientMessageId === undefined) return undefined;
  const tracked = transcript.some((line) => line.meta?.delivery?.clientMessageId === clientMessageId);
  return tracked ? { kind: "ignore" } : undefined;
};

/** The same words this client already has a bubble for, sent from here. */
const alreadyShownAsOwnSend: ArrivalRule = ({ transcript, lines }) => {
  const arriving = lines[0];
  if (arriving?.role !== ChatRole.user) return undefined;
  const text = messageText(arriving);
  if (text === "") return undefined;
  const shown = transcript.some((line) => line.role === ChatRole.user && line.meta?.delivery !== undefined && messageText(line) === text);
  return shown ? { kind: "ignore" } : undefined;
};

/**
 * The same message delivered again - a redelivered event, a reload landing
 * beside a live one, the server's copy of what this browser already sent.
 * Identity says so; before it existed each delivery path had its own test and
 * every duplicate reported was one of those tests' blind spots.
 */
const alreadyInTranscript: ArrivalRule = ({ transcript, lines }) => {
  const arriving = lines[0];
  const identity = arriving === undefined ? undefined : messageIdentity(arriving);
  if (identity === undefined) return undefined;
  return indexOfIdentity(transcript, identity) === -1 ? undefined : { kind: "ignore" };
};

/**
 * An untracked echo of the line just before it: another device's send, or this
 * one after a reload dropped the delivery record.
 */
const repeatsTheLineBefore: ArrivalRule = ({ transcript, lines }) => {
  const arriving = lines[0];
  if (arriving?.role !== ChatRole.user) return undefined;
  const text = messageText(arriving);
  const last = transcript.at(-1);
  if (text === "" || last?.role !== ChatRole.user) return undefined;
  return messageText(last) === text ? { kind: "ignore" } : undefined;
};

const RULES: readonly ArrivalRule[] = [
  supersedesOwnEcho,
  alreadyTrackedById,
  alreadyShownAsOwnSend,
  repeatsTheLineBefore,
  alreadyInTranscript,
];

export function resolveArrival(arrival: Arrival): ArrivalOutcome {
  for (const rule of RULES) {
    const outcome = rule(arrival);
    if (outcome !== undefined) return outcome;
  }
  return { kind: "place" };
}
