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
