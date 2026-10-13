/**
 * The approval page's address: `?machine-access=<request id>`, the link another machine's page
 * hands out when it asks to use this one (docs/design/browser-direct-machines.md).
 */

const PARAM = "machine-access";

export function readMachineAccessRequestId(search: string = window.location.search): string | undefined {
  const id = new URLSearchParams(search).get(PARAM);
  return id === null || id === "" ? undefined : id;
}

export function clearMachineAccessRoute(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
}
