// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor, recordedDelivery } from "./PromptEditor";
import { loadPendingPrompts, moveOutbox, SendScopeChangedError } from "../pendingOutbox";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

async function composer(sessionId = "session-1"): Promise<PromptEditor> {
  const element = new PromptEditor();
  element.sessionId = sessionId;
  element.machineId = "local";
  document.body.append(element);
  await element.updateComplete;
  return element;
}

function fireSend(element: PromptEditor): void {
  const send: unknown = Reflect.get(element, "send");
  if (typeof send !== "function") throw new Error("send is not reachable");
  Reflect.apply(send, element, [undefined]);
}

function deferred(): { promise: Promise<boolean>; resolve: (value: boolean) => void } {
  let resolve: (value: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((settle) => { resolve = settle; });
  return { promise, resolve };
}

const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };

describe("one composer's sends reach the daemon in the order they were made", () => {
  it("hands the second send over once the first has settled, and records both at once", async () => {
    const element = await composer();
    const answers = [deferred(), deferred()];
    const sent: string[] = [];
    element.onSend = (text: string) => {
      sent.push(text);
      return answers[sent.length - 1]?.promise ?? Promise.resolve(true);
    };

    element.replaceText("first");
    fireSend(element);
    element.replaceText("second");
    fireSend(element);
    await flush();
    expect({ sent: [...sent], recorded: loadPendingPrompts("local:session-1").map((prompt) => prompt.text) })
      .toEqual({ sent: ["first"], recorded: ["first", "second"] });

    answers[0]?.resolve(true);
    await flush();
    expect(sent).toEqual(["first", "second"]);
    answers[1]?.resolve(true);
    await flush();
    expect(loadPendingPrompts("local:session-1")).toEqual([]);
  });

  it("keeps going after a send that failed", async () => {
    const element = await composer();
    const sent: string[] = [];
    element.onSend = (text: string) => {
      sent.push(text);
      return text === "first" ? Promise.reject(new Error("400 Bad Request")) : Promise.resolve(true);
    };

    element.replaceText("first");
    fireSend(element);
    element.replaceText("second");
    fireSend(element);
    await flush();

    expect(sent).toEqual(["first", "second"]);
  });

  it("does not hand a waiting send to a session the reader switched to, and keeps it for its own", async () => {
    const element = await composer();
    const first = deferred();
    const sent: string[] = [];
    element.onSend = (text: string) => {
      sent.push(text);
      return text === "first" ? first.promise : Promise.resolve(true);
    };

    element.replaceText("first");
    fireSend(element);
    element.replaceText("second");
    fireSend(element);
    element.sessionId = "session-2";
    await element.updateComplete;
    first.resolve(true);
    await flush();

    expect({ sent, keptForItsSession: loadPendingPrompts("local:session-1").map((prompt) => prompt.text) })
      .toEqual({ sent: ["first"], keptForItsSession: ["second"] });
  });
});

describe("a waiting send only ever goes to the session it was written for", () => {
  it("is not handed over by a composer that was taken off the page, and stays in its session's outbox", async () => {
    const element = await composer();
    const first = deferred();
    const sent: string[] = [];
    element.onSend = (text: string) => {
      sent.push(text);
      return text === "first" ? first.promise : Promise.resolve(true);
    };

    element.replaceText("first");
    fireSend(element);
    element.replaceText("second");
    fireSend(element);
    element.remove();
    first.resolve(true);
    await flush();

    expect({ sent, keptForItsSession: loadPendingPrompts("local:session-1").map((prompt) => prompt.text) })
      .toEqual({ sent: ["first"], keptForItsSession: ["second"] });
  });

  it("hands a send it kept for its own session over once the composer shows that session again", async () => {
    const element = await composer();
    const first = deferred();
    const sent: { text: string; session: string | undefined }[] = [];
    element.onSend = (text: string) => {
      sent.push({ text, session: element.sessionId });
      return text === "first" ? first.promise : Promise.resolve(true);
    };

    element.replaceText("first");
    fireSend(element);
    element.replaceText("second");
    fireSend(element);
    element.sessionId = "session-2";
    await element.updateComplete;
    first.resolve(true);
    await flush();
    element.sessionId = "session-1";
    await element.updateComplete;
    await flush();

    expect({ sent, left: loadPendingPrompts("local:session-1") }).toEqual({
      sent: [{ text: "first", session: "session-1" }, { text: "second", session: "session-1" }],
      left: [],
    });
  });

  it("sends kept records before anything typed after the composer shows their session again", async () => {
    const element = await composer();
    const first = deferred();
    const secondReplay = deferred();
    let replaying = false;
    const sent: string[] = [];
    element.onSend = (text: string) => {
      sent.push(text);
      if (text === "first") return first.promise;
      return text === "second" && replaying ? secondReplay.promise : Promise.resolve(true);
    };

    element.replaceText("first");
    fireSend(element);
    element.replaceText("second");
    fireSend(element);
    element.replaceText("third");
    fireSend(element);
    element.sessionId = "session-2";
    await element.updateComplete;
    first.resolve(true);
    await flush();
    replaying = true;
    element.sessionId = "session-1";
    await element.updateComplete;
    element.replaceText("fourth, typed after coming back");
    fireSend(element);
    await flush();
    secondReplay.resolve(true);
    await flush();

    expect(sent).toEqual(["first", "second", "third", "fourth, typed after coming back"]);
  });

  it("sends a waiting message its session's new identity now holds", async () => {
    const element = await composer();
    const first = deferred();
    const sent: { text: string; session: string | undefined }[] = [];
    element.onSend = (text: string) => {
      sent.push({ text, session: element.sessionId });
      return text === "first" ? first.promise : Promise.resolve(true);
    };

    element.replaceText("first");
    fireSend(element);
    element.sessionId = "pending-session";
    await element.updateComplete;
    element.replaceText("written while the session was starting");
    fireSend(element);
    moveOutbox("local:pending-session", "local:started-session");
    element.sessionId = "started-session";
    await element.updateComplete;
    first.resolve(true);
    await flush();

    expect({ sent, left: loadPendingPrompts("local:started-session") }).toEqual({
      sent: [{ text: "first", session: "session-1" }, { text: "written while the session was starting", session: "started-session" }],
      left: [],
    });
  });

  it("does not replay a send whose request is still in flight", async () => {
    const element = await composer();
    const sent: string[] = [];
    element.onSend = (text: string) => {
      sent.push(text);
      return new Promise<boolean>(() => undefined);
    };

    element.replaceText("still going");
    fireSend(element);
    const flushOutbox: unknown = Reflect.get(element, "flushPendingPrompts");
    if (typeof flushOutbox !== "function") throw new Error("flushPendingPrompts is not reachable");
    Reflect.apply(flushOutbox, element, []);
    await flush();

    expect(sent).toEqual(["still going"]);
  });

  it("hands the controller its own scope, and keeps the record when the controller says the selection moved", async () => {
    const element = await composer();
    const replays: unknown[] = [];
    element.onSend = (_text, _behavior, _attachments, _delivery, replay) => {
      replays.push(replay?.scope);
      return Promise.reject(new SendScopeChangedError({ machineId: "local", sessionId: "session-1" }));
    };

    element.replaceText("written for session one");
    fireSend(element);
    await flush();

    const draft: unknown = Reflect.get(element, "draft");
    expect({
      scope: replays[0],
      kept: loadPendingPrompts("local:session-1").map((prompt) => prompt.text),
      draft,
    }).toEqual({ scope: { machineId: "local", sessionId: "session-1" }, kept: ["written for session one"], draft: "" });
  });
});

describe("a record's attachments travel the way they were composed", () => {
  const image = { kind: "image" as const, name: "p.png", mimeType: "image/png", data: "AAA", size: 3 };
  const file = { kind: "file" as const, name: "notes.txt", mimeType: "text/plain", data: "", size: 0 };

  it("uses the delivery the record carries", () => {
    expect(recordedDelivery({ attachments: [image], delivery: "folder" })).toBe("folder");
  });

  it("answers from the record's own attachments when an older record carries none", () => {
    expect({ image: recordedDelivery({ attachments: [image] }), file: recordedDelivery({ attachments: [file] }) }).toEqual({ image: "inline", file: "folder" });
  });

  it("has no delivery for a record without attachments", () => {
    expect(recordedDelivery({})).toBeUndefined();
  });
});
