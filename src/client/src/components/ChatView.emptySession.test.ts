// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

async function mountChat(patch: Partial<ChatView> = {}): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "019f22c5-d53e-7489-997f-fce17c4dc82f";
  Object.assign(view, patch);
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function emptyState(view: ChatView): HTMLElement | null {
  return view.renderRoot.querySelector<HTMLElement>(".empty-session");
}

describe("a session nobody has spoken to yet", () => {
  /**
   * Measured on a phone: roughly 1160 CSS px of nothing between the header and
   * the composer. The transcript renders no messages, the history boundary
   * returned null because there were none, and the reader was left with a
   * blank screen that never said whether the session was broken, still
   * loading, or simply new.
   */
  it("says the session is empty instead of rendering nothing", async () => {
    const view = await mountChat({ messages: [], messageTotal: 0 });

    const empty = emptyState(view);
    expect(empty).not.toBeNull();
    expect(empty?.textContent ?? "").toMatch(/empty/iu);
  });

  /**
   * A blank region tells a screen reader nothing at all. The empty state is
   * the only thing on screen, so it has to announce itself.
   */
  it("announces itself to a screen reader", async () => {
    const view = await mountChat({ messages: [], messageTotal: 0 });

    expect(emptyState(view)?.getAttribute("role")).toBe("status");
  });

  /**
   * Saying the session is empty without offering the way out leaves the reader
   * exactly where they were. The control puts the cursor where the first
   * message is typed.
   */
  it("offers a control that focuses the composer", async () => {
    const onFocusComposer = vi.fn<() => void>();
    const view = await mountChat({ messages: [], messageTotal: 0, onFocusComposer });

    view.renderRoot.querySelector<HTMLButtonElement>(".empty-session button")?.click();

    expect(onFocusComposer).toHaveBeenCalledOnce();
  });

  it("keeps quiet once the session has something in it", async () => {
    const view = await mountChat({
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      messageTotal: 1,
    });

    expect(emptyState(view)).toBeNull();
  });

  /**
   * An empty transcript during a load is not an empty session, and saying so
   * would contradict the spinner beside it.
   */
  it("keeps quiet while earlier messages are still arriving", async () => {
    const view = await mountChat({ messages: [], messageTotal: 0, loadingMore: true });

    expect(emptyState(view)).toBeNull();
  });
});
