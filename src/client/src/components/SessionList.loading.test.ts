// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { templateText } from "../templateInspection.testSupport";
import { SessionList } from "./SessionList";

afterEach(() => { document.body.replaceChildren(); });

/**
 * The session list had no loading concept: it rendered "No sessions yet" for
 * every workspace whose listing was still in flight, because an unloaded list
 * and a loaded-empty one were both just `sessions: []`. A three-state
 * discipline separates them — the empty claim may only follow a load that
 * completed and returned zero; before that the list shows its previous
 * contents (the per-workspace cache) or a quiet loading state.
 */
describe("the session list knows whether its data is loaded", () => {
  it("does not claim 'No sessions yet' before a load has completed", () => {
    // RED before the discipline: the unloaded state rendered the empty claim.
    const text = templateText(emptyList("unloaded"));
    expect(text).not.toContain("No sessions yet");
  });

  it("shows a quiet loading state while the first listing is in flight", () => {
    const text = templateText(emptyList("loading"));
    expect(text).toContain("Loading sessions");
    expect(text).not.toContain("No sessions yet");
  });

  it("says 'No sessions yet' only once a load completed and returned zero", () => {
    const text = templateText(emptyList("loaded"));
    expect(text).toContain("No sessions yet");
  });

  it("renders the cached list during a background refresh, with no loading line", async () => {
    const list = new SessionList();
    list.sessions = [session("cached")];
    list.sessionsLoad = "loading";
    document.body.append(list);
    await list.updateComplete;

    const text = list.shadowRoot?.textContent ?? "";
    expect(text).toContain("cached");
    expect(text).not.toContain("No sessions yet");
    expect(text).not.toContain("Loading sessions");
  });
});

function emptyList(sessionsLoad: "unloaded" | "loading" | "loaded"): ReturnType<SessionList["render"]> {
  const list = new SessionList();
  list.sessions = [];
  list.sessionsLoad = sessionsLoad;
  return list.render();
}

function session(id: string): SessionInfo {
  return {
    id, name: id, path: `/s/${id}.jsonl`, cwd: "/w",
    created: "2026-08-26T00:00:00.000Z", modified: "2026-08-26T00:00:00.000Z",
    messageCount: 3, firstMessage: "",
  };
}
