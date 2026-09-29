// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";

afterEach(() => { document.body.replaceChildren(); });

/**
 * Attaching a file is asynchronous: it is read to base64 before it joins the
 * composer. Pressing send inside that window sent the text on its own, because
 * the composer still held no attachments - and the image, landing a moment
 * later in a composer whose text had just been cleared, went out as a second
 * message with no text at all.
 *
 * That is what "I only sent it once" looks like in the transcript: one
 * text-only message, then an image with an empty body.
 */
describe("sending while a file is still being read", () => {
  it("sends the text and the attachment as one message", async () => {
    const editor = await mount();
    const sends: { text: string; attachmentCount: number }[] = [];
    editor.onSend = (text, _behavior, attachments) => {
      sends.push({ text, attachmentCount: attachments?.length ?? 0 });
      return Promise.resolve(true);
    };
    Reflect.set(editor, "draft", "look at this");

    const attaching = attachFile(editor);
    callSend(editor);
    await attaching;
    await editor.updateComplete;
    await Promise.resolve();
    await Promise.resolve();

    expect(sends).toHaveLength(1);
    expect(sends[0]?.text).toBe("look at this");
    expect(sends[0]?.attachmentCount).toBe(1);
  });

  it("goes back to idle once the file has been read", async () => {
    const editor = await mount();

    const attaching = attachFile(editor);
    expect(attachingCount(editor)).toBe(1);
    await attaching;

    expect(attachingCount(editor)).toBe(0);
  });

  /**
   * The willUpdate rule clears attachments on a session switch because they
   * belong to the session they were captured in. The capture itself is
   * async: a switch while the file is still being read must not let the
   * late result re-enter the composer for session B.
   */
  it("drops a capture that resolves after a session switch", async () => {
    const editor = await mount();

    const attaching = attachFile(editor);
    editor.sessionId = "s2";
    await editor.updateComplete;
    await attaching;
    await editor.updateComplete;

    expect(attachmentsOf(editor)).toHaveLength(0);
  });

  /**
   * A failed send restores text and attachments so the user does not retype
   * them - but only into the composer they were typed in. A switch while the
   * send is in flight hands the restore to session B otherwise, writing
   * session A's draft into B's store.
   */
  it("restores a failed send only into the session it was sent from", async () => {
    const editor = await mount();
    editor.onSend = () => {
      editor.sessionId = "s2";
      return Promise.resolve(false);
    };

    await callRestore(editor, "look at this", [{ name: "shot.png", kind: "image", dataUrl: "data:image/png;base64,AAA" }]);
    await editor.updateComplete;

    expect(attachmentsOf(editor)).toHaveLength(0);
    expect(Reflect.get(editor, "draft")).toBe("");
  });

  it("gives a session its attached image back when the reader returns to it", async () => {
    const editor = await mount("hold-return");
    await attachFile(editor);

    editor.sessionId = "hold-other";
    await editor.updateComplete;
    const elsewhere = attachmentsOf(editor).length;
    editor.sessionId = "hold-return";
    await editor.updateComplete;

    expect({ elsewhere, back: attachmentsOf(editor).length }).toEqual({ elsewhere: 0, back: 1 });
  });

  it("keeps a file that finished reading after the switch for the session it was attached in", async () => {
    const editor = await mount("hold-late");
    const attaching = attachFile(editor);
    editor.sessionId = "hold-late-other";
    await editor.updateComplete;
    await attaching;

    editor.sessionId = "hold-late";
    await editor.updateComplete;

    expect(attachmentsOf(editor)).toHaveLength(1);
  });

  it("gives the image back to a new composer for the same session", async () => {
    const first = await mount("hold-remount");
    await attachFile(first);
    first.remove();

    const second = await mount("hold-remount");

    expect(attachmentsOf(second)).toHaveLength(1);
  });

  it("restores a failed send when the session is unchanged", async () => {
    const editor = await mount();
    editor.onSend = () => Promise.resolve(false);

    await callRestore(editor, "try again", undefined);
    await editor.updateComplete;

    expect(Reflect.get(editor, "draft")).toBe("try again");
  });
});

async function mount(sessionId = "s"): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = sessionId;
  editor.machineId = "local";
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

/**
 * The composer's internals, reached by name. Driving the private methods keeps
 * the test on the real race rather than on a test-only seam invented for it.
 */
function call(editor: PromptEditor, name: string, args: unknown[]): unknown {
  const value: unknown = Reflect.get(editor, name);
  if (typeof value !== "function") throw new Error(`composer has no ${name}`);
  return Reflect.apply(value, editor, args);
}

function attachingCount(editor: PromptEditor): number {
  const value: unknown = Reflect.get(editor, "attachingCount");
  if (typeof value !== "number") throw new Error("composer does not count files being read");
  return value;
}

function attachFile(editor: PromptEditor): Promise<void> {
  const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
  const result = call(editor, "addAttachmentFiles", [[file]]);
  return result instanceof Promise ? result : Promise.resolve();
}

function callSend(editor: PromptEditor): void {
  call(editor, "send", [undefined]);
}

function attachmentsOf(editor: PromptEditor): unknown[] {
  const value: unknown = Reflect.get(editor, "attachments");
  return Array.isArray(value) ? value : [];
}

async function callRestore(editor: PromptEditor, text: string, attachments: unknown): Promise<void> {
  const result = call(editor, "deliverAndRestoreOnFailure", [text, undefined, attachments, undefined, { text, attachments: [] }]);
  await (result instanceof Promise ? result : Promise.resolve());
}
