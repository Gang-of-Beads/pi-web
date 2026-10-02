import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OwnedPromptQueue, dataDirInboxLocation, entryKey, inboxDirectory, listWaitingInboxes, type OwnedQueueEntry } from "./ownedPromptQueue.js";

/**
 * The inbox's two lists (D1 in docs/design/state-diagram.md, B33): `waiting` is what pi has not
 * been given, `handed` is what pi holds unread. A message moves waiting -> handed when it is taken,
 * leaves handed when it is settled, and goes back to the head of waiting when it is taken back or
 * when a restart finds it unread.
 */
function message(id: string | undefined, text: string): OwnedQueueEntry {
  return { ...(id === undefined ? {} : { clientMessageId: id }), lane: "steer", text, images: [], acceptedAt: "2026-10-01T00:00:00.000Z", echoUserMessage: true };
}

async function inbox() {
  const dataDir = await mkdtemp(join(tmpdir(), "owned-queue-"));
  const queue = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
  await queue.open("s1", "/work");
  return { dataDir, queue };
}

async function fileLists(dataDir: string): Promise<{ waiting: unknown[]; handed: unknown[] }> {
  const parsed: unknown = JSON.parse(await readFile(join(inboxDirectory(dataDir), "s1.json"), "utf8"));
  const texts = (list: unknown): unknown[] => (Array.isArray(list) ? list.map((entry: unknown): unknown => Reflect.get(Object(entry), "text")) : []);
  return { waiting: texts(Reflect.get(Object(parsed), "entries")), handed: texts(Reflect.get(Object(parsed), "handed")) };
}

describe("OwnedPromptQueue handed list", () => {
  it("moves a taken message to handed in the same write, and settles it out", async () => {
    const { dataDir, queue } = await inbox();
    await queue.push("s1", "/work", message("msg-0001", "A"));
    await queue.push("s1", "/work", message("msg-0002", "B"));

    await queue.take("s1", 1);
    const afterTake = await fileLists(dataDir);
    await queue.settleHanded("s1", "msg-0001");

    expect({ afterTake, afterSettle: await fileLists(dataDir), handed: queue.handed("s1").map((entry) => entry.text) }).toEqual({
      afterTake: { waiting: ["B"], handed: ["A"] },
      afterSettle: { waiting: ["B"], handed: [] },
      handed: [],
    });
  });

  it("takes a message back to the head of waiting and out of handed, once", async () => {
    const { queue } = await inbox();
    await queue.push("s1", "/work", message("msg-0001", "A"));
    await queue.push("s1", "/work", message("msg-0002", "B"));
    const [taken] = await queue.take("s1", 1);
    if (taken === undefined) throw new Error("nothing taken");

    await queue.restoreFront("s1", [taken]);
    await queue.restoreFront("s1", [taken]);

    expect({ waiting: queue.entries("s1").map((entry) => entry.text), handed: queue.handed("s1") }).toEqual({ waiting: ["A", "B"], handed: [] });
  });

  it("gives a message sent without an id a daemon key that survives the file", async () => {
    const { dataDir, queue } = await inbox();
    await queue.push("s1", "/work", message(undefined, "no id"));
    const [taken] = await queue.take("s1", 1);
    if (taken === undefined) throw new Error("nothing taken");

    const reopened = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    await reopened.open("s1", "/work");
    const [reloaded] = reopened.handed("s1");

    expect({ key: entryKey(taken).startsWith(" local-hold:"), sameKey: reloaded === undefined ? undefined : entryKey(reloaded) === entryKey(taken) }).toEqual({ key: true, sameKey: true });
  });

  it("after a restart, drops what pi wrote and returns the rest to the head of waiting, in handed order", async () => {
    const { dataDir, queue } = await inbox();
    for (const [id, text] of [["msg-0001", "A"], ["msg-0002", "B"], ["msg-0003", "C"], ["msg-0004", "D"]] as const) await queue.push("s1", "/work", message(id, text));
    await queue.take("s1", 3);

    const restarted = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    await restarted.open("s1", "/work");
    const outcome = await restarted.returnHanded("s1", (entry) => entry.clientMessageId === "msg-0002");

    expect({
      ended: outcome.ended.map((entry) => entry.text),
      returned: outcome.returned.map((entry) => entry.text),
      waiting: restarted.entries("s1").map((entry) => entry.text),
      file: await fileLists(dataDir),
    }).toEqual({ ended: ["B"], returned: ["A", "C"], waiting: ["A", "C", "D"], file: { waiting: ["A", "C", "D"], handed: [] } });
  });

  it("leaves a handed list this process kept alone: its runtime is still reading it", async () => {
    const { queue } = await inbox();
    await queue.push("s1", "/work", message("msg-0001", "A"));
    await queue.take("s1", 1);

    await queue.open("s1", "/work");
    const outcome = await queue.returnHanded("s1", () => false);

    expect({ returned: outcome.returned, handed: queue.handed("s1").map((entry) => entry.text), waiting: queue.entries("s1") }).toEqual({ returned: [], handed: ["A"], waiting: [] });
  });

  it("reads a file written before the handed list as nothing handed, and finds a session whose only messages are handed", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "owned-queue-old-"));
    await mkdir(inboxDirectory(dataDir), { recursive: true });
    await writeFile(join(inboxDirectory(dataDir), "old.json"), JSON.stringify({ cwd: "/work", entries: [message("msg-0009", "old")] }));
    await writeFile(join(inboxDirectory(dataDir), "held.json"), JSON.stringify({ cwd: "/work", entries: [], handed: [message("msg-0010", "held")] }));
    const queue = new OwnedPromptQueue(dataDirInboxLocation(dataDir));

    const waiting = await queue.open("old", "/work");

    expect({ waiting: waiting.map((entry) => entry.text), handed: queue.handed("old"), sessions: (await listWaitingInboxes(dataDir)).map((entry) => entry.sessionId).sort() }).toEqual({
      waiting: ["old"],
      handed: [],
      sessions: ["held", "old"],
    });
  });
});

describe("the send time survives the inbox file (B5)", () => {
  it("keeps a message's send time across a restart, and gives a file written before it the acceptance time", async () => {
    const { dataDir, queue } = await inbox();
    await queue.push("s1", "/work", { ...message("msg-0001", "A"), sentAt: "2026-09-30T23:59:58.000Z" });
    const reopened = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    await reopened.open("s1", "/work");
    const kept = reopened.entries("s1")[0]?.sentAt;

    await writeFile(join(inboxDirectory(dataDir), "s2.json"), JSON.stringify({ entries: [message("msg-0002", "B")], handed: [] }));
    const older = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    await older.open("s2", "/work");

    expect({ kept, fromAnOlderFile: older.entries("s2")[0]?.sentAt }).toEqual({ kept: "2026-09-30T23:59:58.000Z", fromAnOlderFile: "2026-10-01T00:00:00.000Z" });
  });
});

