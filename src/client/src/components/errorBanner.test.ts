// @vitest-environment happy-dom
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBanner, isTransientError } from "./errorBanner";

afterEach(() => {
  document.body.replaceChildren();
});

function renderBanner(error: string, onDismiss = vi.fn()): { host: HTMLElement; onDismiss: ReturnType<typeof vi.fn> } {
  const host = document.createElement("div");
  document.body.append(host);
  render(errorBanner(error, onDismiss), host);
  return { host, onDismiss };
}

describe("errorBanner", () => {
  it("renders nothing when there is no error", () => {
    const { host } = renderBanner("");

    expect(host.querySelector(".error")).toBeNull();
  });

  it("announces the message and dismisses it on request", () => {
    const { host, onDismiss } = renderBanner("Failed to start workspace removal: HTTP request cancelled");

    const banner = host.querySelector(".error");
    expect(banner?.getAttribute("role")).toBe("alert");
    expect(banner?.textContent).toContain("Failed to start workspace removal: HTTP request cancelled");

    const dismiss = host.querySelector<HTMLButtonElement>(".error-dismiss");
    expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss error");
    dismiss?.click();

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});


describe("isTransientError", () => {
  it("recognises the self-healing transport failures", () => {
    expect(isTransientError("session daemon workspace authority unavailable: connect ENOENT /x/sessiond.sock")).toBe(true);
    expect(isTransientError("Model response failed: this operation was aborted")).toBe(true);
    expect(isTransientError("remote machine request cancelled")).toBe(true);
  });

  /**
   * A deadline miss is self-healing in exactly the way the reconnect notices
   * are: the polls re-issue themselves, and the session that was streaming
   * when the deadline fired goes on replying. Measured live: a remote
   * machine's /status and /messages both crossed the 30s deadline and the
   * banner outlived the working session until dismissed by hand.
   */
  it("treats a request deadline as transient", () => {
    expect(isTransientError("The server did not answer within 30s.")).toBe(true);
  });

  it("does not treat a real failure as transient", () => {
    // A permanent failure must never expire on its own; the user has to see it.
    expect(isTransientError("Model response failed: 401 OAuth access token has been revoked")).toBe(false);
    expect(isTransientError("ENOENT: no such file or directory, copyfile")).toBe(false);
    expect(isTransientError("")).toBe(false);
  });
});

describe("aborted requests", () => {
  // A cancelled fetch reaches the banner as String(error), i.e. the
  // DOMException text, with no "Model response failed:" prefix -- that prefix
  // only ever appears on a transcript system line, so the rule written for it
  // could never fire here. Navigating away or losing the network mid-request
  // is self-healing and should not be dressed as a failure.
  it("treats a cancelled request as transient", () => {
    expect(isTransientError("AbortError: The operation was aborted.")).toBe(true);
    expect(isTransientError("The operation was aborted")).toBe(true);
  });

  it("still treats a genuine failure as permanent", () => {
    expect(isTransientError("Session not found: no such file or directory")).toBe(false);
    expect(isTransientError("Model aborted the tool call for policy reasons")).toBe(false);
  });
});

describe("daemon restart", () => {
  // Restarting the daemon produces ECONNREFUSED, not ENOENT: the socket file is
  // still there, nothing is listening yet. The rule matched only ENOENT, so the
  // one error a user is guaranteed to see after an update arrived as a
  // permanent failure -- observed in a screenshot moments after a restart.
  it("treats a refused daemon connection as transient", () => {
    expect(isTransientError(
      "Session daemon workspace authority unavailable: connect ECONNREFUSED /home/u/.pi-web/sessiond.sock",
    )).toBe(true);
  });

  it("still treats a missing socket as transient", () => {
    expect(isTransientError(
      "Session daemon workspace authority unavailable: connect ENOENT /home/u/.pi-web/sessiond.sock",
    )).toBe(true);
  });

  it("does not demote an unrelated connection failure", () => {
    // Nothing here says the session daemon is restarting, so it must not be
    // dressed up as something that heals itself.
    expect(isTransientError("connect ECONNREFUSED 127.0.0.1:5432")).toBe(false);
  });
});

describe("dropped-connection failures", () => {
  // The raw TypeError sat at the top of the screen long after the connection
  // was back: a phone that slept, a tunnel that blinked, or a web process being
  // restarted all produce it, and all of them heal by themselves.
  it("reads every browser's dropped-fetch wording as self-healing", () => {
    for (const raw of ["TypeError: Failed to fetch", "TypeError: Load failed", "NetworkError when attempting to fetch resource."]) {
      expect(isTransientError(raw)).toBe(true);
      const { host } = renderBanner(raw);
      expect(host.querySelector(".error")?.getAttribute("role")).toBe("status");
      expect(host.querySelector(".error-text")?.textContent).toContain("Lost connection to PI WEB");
    }
  });

  it("still treats an ordinary failure as permanent", () => {
    expect(isTransientError("TypeError: cannot read properties of undefined")).toBe(false);
  });
});

describe("the daemon-unavailable banner the server actually sends", () => {
  /**
   * The self-healing rule was written against one wording - "Session daemon
   * workspace authority unavailable" - which only the workspace catalog sends.
   * The session proxy, the plugin backend proxy and workspace deletion all
   * send the plain "Session daemon unavailable", which is what a reader meets
   * whenever the daemon restarts. That banner never matched, so it never
   * withdrew itself: it sat at the top of the screen long after the daemon was
   * back, and only a click would remove it.
   *
   * This is the second time this rule has been written from an imagined string
   * rather than the emitted one; these cases are copied from the server.
   */
  it("heals the message the session proxy sends", () => {
    expect(isTransientError("HttpError: Session daemon unavailable: connect ENOENT /Users/me/.pi-web/sessiond.sock")).toBe(true);
  });

  it("heals it while the daemon is still starting up", () => {
    expect(isTransientError("Session daemon unavailable: connect ECONNREFUSED /Users/me/.pi-web/sessiond.sock")).toBe(true);
  });

  it("still heals the workspace authority wording", () => {
    expect(isTransientError("Session daemon workspace authority unavailable: connect ENOENT /Users/me/.pi-web/sessiond.sock")).toBe(true);
  });

  /**
   * A failure that is not the daemon being briefly away must still wait for
   * the reader, or a real problem disappears before it is read.
   */
  it("leaves a failure that will not heal itself alone", () => {
    expect(isTransientError("Session daemon unavailable: permission denied")).toBe(false);
  });
});
