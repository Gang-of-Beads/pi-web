/**
 * A browser tab keeps running the bundle it loaded, however many times the
 * server underneath it is upgraded. Every client-side fix shipped during that
 * time is invisible to the reader, who reports the same defect again - the
 * expensive way to learn the tab is stale. The server states its version; a
 * mismatch is an offer to reload, never an automatic one: reloading is the
 * reader's move, made when it will not lose them anything.
 */
export function reloadOffer(clientVersion: string, serverVersion: string | undefined): string | undefined {
  if (clientVersion === "" || serverVersion === undefined || serverVersion === "") return undefined;
  return serverVersion === clientVersion ? undefined : serverVersion;
}
