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
