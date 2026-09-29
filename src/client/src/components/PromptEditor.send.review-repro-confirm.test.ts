// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unsafe-assignment -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */

import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";
import { effectivePromptAttachmentDelivery } from "../promptAttachmentCapture";
import { loadPendingPrompts, savePendingPrompt } from "../pendingOutbox";

/**
 * Lane "confirm": what the composer does between the reader's keypress and the
 * daemon's acceptance.
 *
 * Three questions the owner asked, each turned into an executable invariant:
 *  - can two sends from one composer be in flight at once, in whatever order
 *    the network delivers them?
 *  - is a send pressed while another is uploading swallowed?
 *  - is a replayed outbox entry sent the way its own attachments were composed,
 *    or the way the composer happens to look at replay time?
 */

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

const SESSION_KEY = "local:session-1";

async function composer(): Promise<PromptEditor> {
  const element = new PromptEditor();
  element.sessionId = "session-1";
  element.machineId = "local";
  document.body.append(element);
  await element.updateComplete;
  return element;
}

function draftOf(element: PromptEditor): string {
  return Reflect.get(element, "draft") as string;
}

/** The composer's pending attachments are @state-private; the seam is the field itself. */
function setPendingAttachments(element: PromptEditor, attachments: unknown[]): void {
  Reflect.set(element, "attachments", attachments);
}

function fireSend(element: PromptEditor): void {
  const send = Reflect.get(element, "send") as (behavior?: string) => void;
  Reflect.apply(send, element, [undefined]);
}

function fireFlush(element: PromptEditor): void {
  const flush = Reflect.get(element, "flushPendingPrompts") as () => void;
  Reflect.apply(flush, element, []);
}

function recordSend(calls: unknown[][]) {
  return (...args: unknown[]): Promise<boolean> => {
    calls.push(args);
    return Promise.resolve(true);
  };
}

const fileAttachment = { kind: "file" as const, name: "notes.txt", mimeType: "text/plain", data: "", size: 0 };
const imageAttachment = { kind: "image" as const, name: "p.png", mimeType: "image/png", data: "AAA", size: 3 };

describe("two Enter presses, one composer", () => {
  it("leaves both sends in flight with nothing ordering them", async () => {
    const element = await composer();
    const calls: unknown[][] = [];
    element.onSend = (...args: unknown[]) => {
      calls.push(args);
      return new Promise<boolean>(() => undefined);
    };

    element.replaceText("first");
    fireSend(element);
    element.replaceText("second");
    fireSend(element);
    await Promise.resolve();

    // Invariant (2): the daemon accepts messages from one composer in the order
    // they were sent. Two independent POSTs in flight make that the network's
    // decision. PromptEditor.ts:1210 gates on `this.disabled || this.sending`,
    // and `sending` is only ever set for a send with attachments
    // (sessionController.ts:542 passes markSending: hasAttachments).
    expect({ sendsIssued: calls.length, ids: calls.map((call) => call[4]) }).toMatchObject({ sendsIssued: 1 });
  });

  it("swallows the second send when the first is uploading", async () => {
    const element = await composer();
    const calls: unknown[][] = [];
    element.onSend = recordSend(calls);
    setPendingAttachments(element, [{ id: "a1", ...imageAttachment }]);
    element.sending = true;
    element.replaceText("second");
    fireSend(element);
    await Promise.resolve();

    // The button is disabled while `sending`, so a tap is refused by the DOM and
    // a swallowed send is invisible. Enter goes straight to send(), which
    // returns early: no bubble, no notice, no state change.
    expect({ sendsIssued: calls.length, draft: draftOf(element) }).toMatchObject({ sendsIssued: 1 });
  });
});

describe("a replayed outbox entry", () => {
  it("is sent with the delivery its own attachments chose", async () => {
    const element = await composer();
    savePendingPrompt(SESSION_KEY, {
      text: "read this",
      clientMessageId: "cm-file",
      attachments: [fileAttachment],
      at: new Date().toISOString(),
    });
    const calls: unknown[][] = [];
    element.onSend = recordSend(calls);

    fireFlush(element);
    await new Promise((resolve) => setTimeout(resolve, 5));

    // The record stores text, kind and attachments but no delivery, and
    // PromptEditor.ts:1191 recomputes it from `this.attachments` - the live
    // composer, which resetComposer emptied when the message was sent. The
    // compose-time answer for this record is "folder" (the file has to be saved
    // into the workspace); the replay sends it inline.
    expect({
      delivery: calls[0]?.[3],
      composeTime: effectivePromptAttachmentDelivery("inline", [fileAttachment]),
      composerHolds: Reflect.get(element, "attachments"),
    }).toMatchObject({ delivery: "folder" });
  });

  it("is not turned into a workspace file because the composer holds one", async () => {
    const element = await composer();
    savePendingPrompt(SESSION_KEY, {
      text: "look at this",
      clientMessageId: "cm-image",
      attachments: [imageAttachment],
      at: new Date().toISOString(),
    });
    setPendingAttachments(element, [{ id: "a2", ...fileAttachment }]);
    const calls: unknown[][] = [];
    element.onSend = recordSend(calls);

    fireFlush(element);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect({
      delivery: calls[0]?.[3],
      composeTime: effectivePromptAttachmentDelivery("inline", [imageAttachment]),
    }).toMatchObject({ delivery: "inline" });
  });

  it("carries the kind it froze at compose time", async () => {
    const element = await composer();
    savePendingPrompt(SESSION_KEY, {
      text: "queued while idle",
      clientMessageId: "cm-kind",
      behavior: "steer",
      at: new Date().toISOString(),
    });
    const calls: unknown[][] = [];
    element.onSend = recordSend(calls);

    fireFlush(element);
    await new Promise((resolve) => setTimeout(resolve, 5));

    // True today (this is the proven FIFO trigger, kept here as the baseline the
    // delivery recomputation above sits beside): the replay hands the daemon the
    // kind the composer decided when the phone still showed "idle".
    expect({ kind: calls[0]?.[1], id: calls[0]?.[4] }).toMatchObject({ kind: "steer" });
    expect(loadPendingPrompts(SESSION_KEY)).toHaveLength(0);
  });
});
