import type { OperationAppliedOutcome } from "../../shared/apiTypes";

/**
 * A message whose attachments this browser lost before the machine answered for it asks the
 * machine by a take-back of its identity (pendingOutbox.lostAttachmentsTakeBack); the answer says
 * what became of it (docs/design/message-states.md, "Take-back answers"). The machine takes back
 * an identity it never received (a tombstone) and one it holds queued alike, and the page cannot
 * tell the two apart, nor needs to: either way the agent does not have the message, so it fails
 * here and its words come back. Too late means the agent has it: it stands delivered. Accepted is
 * not a take-back answer; it is mapped like too late, so if a machine ever answers it the message
 * stands delivered and is never sent twice. A take-back refused for good means the session takes no words any more, so returning them cannot send the
 * message twice (owner, 2026-10-19). An unanswered take-back is not an answer: it is sent again.
 */
export type LostAttachmentsFate = "notSent" | "delivered";

export type LostAttachmentsAnswer = OperationAppliedOutcome | "refused";

const FATE: Readonly<Record<LostAttachmentsAnswer, LostAttachmentsFate>> = {
  takenBack: "notSent",
  refused: "notSent",
  tooLate: "delivered",
  accepted: "delivered",
};

export function lostAttachmentsFate(answer: LostAttachmentsAnswer): LostAttachmentsFate {
  return FATE[answer];
}

/** The one notice the returned words carry to the composer: why the message was not sent, and the machine's reason when it refused. */
export function lostAttachmentsNotice(count: number, refusal: string | undefined): string {
  const lost = count === 1
    ? "Not sent: this browser no longer has its attachment, so send it again with the file."
    : `Not sent: this browser no longer has its ${String(count)} attachments, so send it again with the files.`;
  return refusal === undefined ? lost : `${lost} ${machineSaid(refusal)}`;
}

/** The notice when the words come back with the attachments a Take back press kept: only the machine's reason, when it refused. */
export function refusalNotice(refusal: string | undefined): string | undefined {
  return refusal === undefined ? undefined : `Not sent. ${machineSaid(refusal)}`;
}

function machineSaid(refusal: string): string {
  return `The machine said: ${refusal}`;
}
