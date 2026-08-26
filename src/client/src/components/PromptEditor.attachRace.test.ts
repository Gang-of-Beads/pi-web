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
});

async function mount(): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "s";
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
