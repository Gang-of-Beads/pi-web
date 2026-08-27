import { describe, expect, it } from "vitest";
import { restoresDraftOnFirstRender, savesOutgoingDraft } from "../promptDraftStorage";

describe("a draft that outlives a page refresh", () => {
  /**
   * Every keystroke is saved, but the draft was only read back when the
   * session or machine changed. A refresh builds the editor fresh, so those
   * are initial values rather than changes: the guard returned before the load
   * and the typed text was gone, even though it was sitting in storage.
   *
   * The first render is exactly when a draft has to be restored - that is the
   * moment the reader comes back to.
   */
  it("restores on the first render, when nothing has changed yet", () => {
    expect(restoresDraftOnFirstRender({ hasRendered: false, sessionChanged: false, machineChanged: false })).toBe(true);
  });

  it("restores when the reader moves to another session", () => {
    expect(restoresDraftOnFirstRender({ hasRendered: true, sessionChanged: true, machineChanged: false })).toBe(true);
  });

  it("restores when the machine changes under the same session id", () => {
    expect(restoresDraftOnFirstRender({ hasRendered: true, sessionChanged: false, machineChanged: true })).toBe(true);
  });

  /**
   * Reloading the draft on every render would fight the reader: it would
   * overwrite what they are typing with what was last stored.
   */
  it("leaves an established editor alone", () => {
    expect(restoresDraftOnFirstRender({ hasRendered: true, sessionChanged: false, machineChanged: false })).toBe(false);
  });
});

describe("what the editor may overwrite on the way in", () => {
  /**
   * Restoring runs the same code that hands a draft back when the reader
   * switches session: it saves what was in the editor before loading what
   * belongs to the new one. On the first render there is nothing in the editor
   * yet, and the key it would save under is the same one it is about to read,
   * so that save would clear the draft a moment before restoring it - leaving
   * exactly the empty box this fix set out to prevent.
   */
  it("does not save an empty editor over the draft it is about to restore", () => {
    expect(savesOutgoingDraft({ hasRendered: false })).toBe(false);
  });

  it("still hands the outgoing draft back when leaving a session", () => {
    expect(savesOutgoingDraft({ hasRendered: true })).toBe(true);
  });
});
