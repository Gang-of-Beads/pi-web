import { describe, expect, it } from "vitest";
import { sessionActivityLabel } from "./sessionActivityLabel";

describe("sessionActivityLabel", () => {
  // Caught live: /compact runs inside a session-entry mutation (the transcript
  // rewrite), so the mutation branch — checked first — answered the generic
  // "updating session" for the whole compaction and the specific state never
  // surfaced. The specific truth wins over the mechanism it happens to use.
  it("says compacting even while the entry mutation is active", () => {
    expect(sessionActivityLabel({ entryMutationActive: true, isCompacting: true, isBashRunning: false, isStreaming: false, pendingMessageCount: 0 })).toBe("compacting");
  });

  it("keeps the tree navigation ahead of everything", () => {
    expect(sessionActivityLabel({ treeNavigationActive: true, entryMutationActive: true, isCompacting: true, isBashRunning: true, isStreaming: true, pendingMessageCount: 3 })).toBe("navigating session tree");
  });

  it("answers the generic mutation label when nothing more specific holds", () => {
    expect(sessionActivityLabel({ entryMutationActive: true, isCompacting: false, isBashRunning: false, isStreaming: false, pendingMessageCount: 0 })).toBe("updating session");
  });

  it("keeps the remaining order: bash, streaming, queued, active", () => {
    expect(sessionActivityLabel({ entryMutationActive: false, isCompacting: false, isBashRunning: true, isStreaming: true, pendingMessageCount: 2 })).toBe("running bash");
    expect(sessionActivityLabel({ entryMutationActive: false, isCompacting: false, isBashRunning: false, isStreaming: true, pendingMessageCount: 2 })).toBe("agent running");
    expect(sessionActivityLabel({ entryMutationActive: false, isCompacting: false, isBashRunning: false, isStreaming: false, pendingMessageCount: 2 })).toBe("queued");
    expect(sessionActivityLabel({ entryMutationActive: false, isCompacting: false, isBashRunning: false, isStreaming: false, pendingMessageCount: 0 })).toBe("active");
  });

  it("does not let compaction hide a streaming reply", () => {
    expect(sessionActivityLabel({ isCompacting: true, isStreaming: true, isBashRunning: false, pendingMessageCount: 0 })).toBe("agent running · compacting");
  });

  it("does not let compaction hide a running command", () => {
    expect(sessionActivityLabel({ isCompacting: true, isStreaming: false, isBashRunning: true, pendingMessageCount: 0 })).toBe("running bash · compacting");
  });

  it("does not let compaction hide waiting messages", () => {
    expect(sessionActivityLabel({ isCompacting: true, isStreaming: false, isBashRunning: false, pendingMessageCount: 2 })).toBe("queued · compacting");
  });

  it("says compacting alone when nothing else is happening", () => {
    expect(sessionActivityLabel({ isCompacting: true, isStreaming: false, isBashRunning: false, pendingMessageCount: 0 })).toBe("compacting");
  });
});
