// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";
import type { PromptAttachment } from "../api";

const IMAGE_DATA = "iVBORw0KGgo=";

function imageAttachment(): PromptAttachment {
  return { kind: "image", name: "shot.png", mimeType: "image/png", data: IMAGE_DATA };
}

async function mountWithImage(): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "s";
  editor.machineId = "local";
  Reflect.set(editor, "attachments", [{ id: "a1", ...imageAttachment() }]);
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function thumbnail(editor: PromptEditor): HTMLImageElement {
  const img = editor.shadowRoot?.querySelector<HTMLImageElement>(".attachment-chip-image img");
  if (img === null || img === undefined) throw new Error("expected an attachment thumbnail");
  return img;
}

function zoomDialog(editor: PromptEditor): HTMLDialogElement {
  const dialog = editor.shadowRoot?.querySelector<HTMLDialogElement>("dialog.attachment-zoom");
  if (dialog === null || dialog === undefined) throw new Error("expected the attachment zoom dialog");
  return dialog;
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("attachment thumbnail zoom", () => {
  // The composer's image thumbnails used to be inert <img> elements: no role,
  // no keyboard affordance, no way to see the picture the way a message image
  // can be enlarged. The failure was invisible to a mouse user who never
  // clicks a thumbnail expecting a zoom, and loud for a phone user tapping one.
  it("opens the zoom for a tapped thumbnail, with the whole image and a close button", async () => {
    const editor = await mountWithImage();
    const img = thumbnail(editor);

    expect(img.getAttribute("role")).toBe("button");
    expect(img.getAttribute("tabindex")).toBe("0");

    img.click();
    await editor.updateComplete;

    const dialog = zoomDialog(editor);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector<HTMLImageElement>(".attachment-zoom-full")?.getAttribute("src")).toBe(`data:image/png;base64,${IMAGE_DATA}`);
    expect(editor.shadowRoot?.activeElement?.classList.contains("attachment-zoom-close")).toBe(true);
  });

  it("closes on the close button, on cancel, and on a backdrop click", async () => {
    const editor = await mountWithImage();
    thumbnail(editor).click();
    await editor.updateComplete;
    const dialog = zoomDialog(editor);
    expect(dialog.open).toBe(true);

    dialog.querySelector<HTMLButtonElement>(".attachment-zoom-close")?.click();
    await editor.updateComplete;
    expect(dialog.open).toBe(false);

    thumbnail(editor).click();
    await editor.updateComplete;
    expect(dialog.open).toBe(true);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await editor.updateComplete;
    expect(dialog.open).toBe(false);

    thumbnail(editor).click();
    await editor.updateComplete;
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    await editor.updateComplete;
    expect(dialog.open).toBe(false);
  });

  it("opens the zoom from the keyboard", async () => {
    const editor = await mountWithImage();
    const img = thumbnail(editor);
    img.focus();

    img.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await editor.updateComplete;

    expect(zoomDialog(editor).open).toBe(true);
  });
});