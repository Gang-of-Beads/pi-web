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
 * its record, health and runtime (`api/machines/local/…`), and its plugin assets (`pi-web-plugins/…`).
 */

/** Machines this page reaches from the browser: id to base URL. */
export type DirectMachines = ReadonlyMap<string, string>;

/** The remote machines in a list that this browser reaches itself. */
export function directMachinesOf(machines: readonly Machine[]): DirectMachines {
  return new Map(machines.flatMap((machine) => (machine.kind === "remote" && machine.connectFrom === "browser" && machine.baseUrl !== undefined ? [[machine.id, machine.baseUrl] as const] : [])));
}

const MACHINE_PATH = /^\/?api\/machines\/([^/?#]+)([/?#].*)?$/u;

type DirectRoute = "plugin-asset" | "machine-record" | "forwarded";

const ROUTE_TARGET: Readonly<Record<DirectRoute, (rest: string) => string>> = {
  "plugin-asset": (rest) => rest.slice(1),
  "machine-record": (rest) => `api/machines/local${rest}`,
  forwarded: (rest) => `api${rest.startsWith("/") ? rest : `/${rest}`}`,
};

/** The paths the gateway answers for a machine instead of forwarding them (`localMachineRegistry.ts`). */
const MACHINE_RECORD_PATH = /^(?:[?#].*)?$|^\/(?:health|runtime)(?:[?#].*)?$/u;

function routeOf(rest: string): DirectRoute {
  if (rest.startsWith("/pi-web-plugins/")) return "plugin-asset";
  return MACHINE_RECORD_PATH.test(rest) ? "machine-record" : "forwarded";
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
  return new URL(ROUTE_TARGET[routeOf(rest)](rest), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
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
