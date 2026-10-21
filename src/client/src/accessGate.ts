import { signInPageUrl } from "./api/urls";

/**
 * What this page does because this server's access gate is on (docs/install.md, "Require an access
 * token"), and nothing of it while the gate is off. `PiWebApp` and the socket-close read
 * (`sessionSocket.ts`) switch it on when the local runtime names the `access-token` capability; only
 * leaving the page switches it off, since a gate turned off later makes a renewal read harmless.
 *
 * It keeps the sign-in cookie alive while the app is in use (owner, 2026-10-21: "30 days idle,
 * renewed on use"). The server renews the cookie on a read of the sign-in page, which sits at the
 * app's base (so the renewed cookie keeps the base as its path) and which the Vite dev server
 * proxies to the web process. API traffic alone never renews it, so while the page is visible the
 * app reads the sign-in page at most once a day: on an hourly check, and whenever the page comes
 * back to the foreground, so brief daily visits between checks count too. A failed read is left
 * alone: the next API request says whether this browser is still signed in.
 */

const RENEW_EVERY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

let renewal: { readonly stop: () => void } | undefined;

export function accessGateOn(): boolean {
  return renewal !== undefined;
}

export function setAccessGateOn(on: boolean): void {
  if (on === accessGateOn()) return;
  if (on) {
    renewal = startRenewal();
    return;
  }
  renewal?.stop();
  renewal = undefined;
}

function startRenewal(): { readonly stop: () => void } {
  let renewedAt = Date.now();
  const renewIfDue = (): void => {
    if (document.visibilityState !== "visible" || Date.now() - renewedAt < RENEW_EVERY_MS) return;
    renewedAt = Date.now();
    fetch(signInPageUrl(), { method: "HEAD", cache: "no-store", credentials: "same-origin" }).catch(() => undefined);
  };
  // Surface backed up: the access gate's sign-in cookie, which API traffic alone never renews.
  const timer = window.setInterval(renewIfDue, CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", renewIfDue);
  window.addEventListener("pageshow", renewIfDue);
  return {
    stop: () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", renewIfDue);
      window.removeEventListener("pageshow", renewIfDue);
    },
  };
}
