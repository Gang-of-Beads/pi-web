import type { Machine } from "../../shared/apiTypes";

/**
 * Where a machine-scoped application path goes when this browser reaches the machine itself
 * (docs/design/browser-direct-machines.md; owner, 2026-10-13: connect from the browser, not the server).
 *
 * Every machine-scoped reference in the page is an application path `api/machines/<id>/…`, resolved
 * once at the browser boundary (`resolveAppUrl`). For a machine reached through this server, the path
 * stays on this origin and the gateway forwards it. For a machine this browser reaches directly, the
 * same path is rewritten here, once, to the machine's own address, by the gateway's own rule
 * (`remoteApiPath`): `api/machines/<id>/X` is that machine's `api/X`. Two kinds of path the gateway
 * does not forward, because it answers them itself, go where the machine answers them for itself:
 * its health and runtime (`api/machines/local/…`), and its plugin assets (`pi-web-plugins/…`). The
 * machine's entry in the list (`api/machines/<id>` itself: read, renamed, removed) stays here: the
 * list lives on the PI WEB this page came from (decision 2a). Sent to the machine, a removal deleted
 * nothing from the list (8505, 2026-10-13).
 */

/** Machines this page reaches from the browser: id to base URL. */
export type DirectMachines = ReadonlyMap<string, string>;

/** The remote machines in a list that this browser reaches itself. */
export function directMachinesOf(machines: readonly Machine[]): DirectMachines {
  return new Map(machines.flatMap((machine) => (machine.kind === "remote" && machine.connectFrom === "browser" && machine.baseUrl !== undefined ? [[machine.id, machine.baseUrl] as const] : [])));
}

const MACHINE_PATH = /^\/?api\/machines\/([^/?#]+)([/?#].*)?$/u;

type DirectRoute = "list-entry" | "plugin-asset" | "machine-self" | "forwarded";

/** Where each kind of path goes on the machine; undefined keeps it on this PI WEB. */
const ROUTE_TARGET: Readonly<Record<DirectRoute, (rest: string) => string | undefined>> = {
  "list-entry": () => undefined,
  "plugin-asset": (rest) => rest.slice(1),
  "machine-self": (rest) => `api/machines/local${rest}`,
  forwarded: (rest) => `api${rest}`,
};

/** The kinds of path by their shape, first match first; anything else the gateway would forward. */
const ROUTE_BY_SHAPE: readonly (readonly [RegExp, DirectRoute])[] = [
  [/^(?:[?#].*)?$/u, "list-entry"],
  [/^\/pi-web-plugins\//u, "plugin-asset"],
  [/^\/(?:health|runtime)(?:[?#].*)?$/u, "machine-self"],
];

function routeOf(rest: string): DirectRoute {
  return ROUTE_BY_SHAPE.find(([shape]) => shape.test(rest))?.[1] ?? "forwarded";
}

/** The machine's own URL for an application path, or undefined when the path is not for a direct machine. */
export function directMachineUrl(path: string, machines: DirectMachines): string | undefined {
  if (machines.size === 0) return undefined;
  const match = MACHINE_PATH.exec(path);
  const encodedId = match?.[1];
  if (encodedId === undefined) return undefined;
  const baseUrl = machines.get(decodedOrRaw(encodedId));
  if (baseUrl === undefined) return undefined;
  const rest = match?.[2] ?? "";
  const target = ROUTE_TARGET[routeOf(rest)](rest);
  return target === undefined ? undefined : new URL(target, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

/** A malformed escape in an id is not a direct machine; the resolver must not throw for it. */
function decodedOrRaw(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

let current: DirectMachines = new Map();

/**
 * The page's direct machines: set from the roster as it arrives (`MachineController.applyRoster`,
 * before anything reads a machine) and on every machine-list change (`PiWebApp.setState`).
 */
export function setDirectMachines(machines: DirectMachines): void {
  current = machines;
}

export function directMachines(): DirectMachines {
  return current;
}
