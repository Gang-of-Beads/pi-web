import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { piWebDataDir } from "../../../config.js";
import { isNodeErrorWithCode } from "../workspaces/pathSafety.js";
import { orderedIds } from "../../../shared/listOrder.js";

/**
 * Which sessions are kept close on this machine.
 *
 * A pin used to live in the browser's local storage, which made it a property
 * of a device: the owner pinned on the phone and the desktop knew nothing
 * about it. A pin names a session, and a session belongs to a machine, so the
 * machine holds the set and every device that browses it sees the same pins.
 *
 * Two kinds (owner, 2026-09-30, B49; object-model 1.14): a global pin, listed
 * in the machine's PINNED whatever projects are open, and a project pin, kept
 * at the top of that project's list. Both live in this one file, so one write
 * tail serialises them and one announcement covers them. Pinned projects live
 * here too (R11 slice 3): they were a device's, kept in its browser storage, so
 * the phone and the desktop disagreed about which projects stood first.
 *
 * Writes are serialised through one tail so two devices pinning at the same
 * moment cannot lose one another's pin to a read-modify-write race. Whether a
 * write changed the set is decided inside that tail too, and only a change
 * calls `onChange`: every page load adopts, and a repeated pin is common, so
 * announcing those would make every browser read the pins for nothing.
 */

export function sessionPinStorePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_SESSION_PINS_FILE"];
  if (configured === undefined || configured === "") return join(piWebDataDir(env, cwd), "session-pins.json");
  return resolve(cwd, configured);
}

/** The machine's pins: the global ones, each project's own by project id, and the pinned projects in the reader's order. */
export interface SessionPins {
  readonly global: readonly string[];
  readonly projects: Readonly<Record<string, readonly string[]>>;
  readonly pinnedProjects: readonly string[];
}

/** One change to the pins, applied inside the write tail. */
export type PinChange = (pins: SessionPins) => SessionPins;

export function globalPin(sessionId: string, pinned: boolean): PinChange {
  return (pins) => ({ ...pins, global: toggled(pins.global, sessionId, pinned) });
}

export function projectPin(projectId: string, sessionId: string, pinned: boolean): PinChange {
  return (pins) => ({ ...pins, projects: withProject(pins.projects, projectId, toggled(pins.projects[projectId] ?? [], sessionId, pinned)) });
}

/** A device's pins from before pins were machine-owned, kept beside the machine's. */
export function adoptedPins(sessionIds: readonly string[]): PinChange {
  return (pins) => ({ ...pins, global: [...new Set([...pins.global, ...sessionIds])] });
}

/** A project pinned or unpinned on this machine; a new pin goes last. */
export function pinnedProject(projectId: string, pinned: boolean): PinChange {
  return (pins) => ({ ...pins, pinnedProjects: toggled(pins.pinnedProjects, projectId, pinned) });
}

/** The pinned projects in the order the reader dragged them into, applied as `orderedIds` does. */
export function pinnedProjectOrder(order: readonly string[]): PinChange {
  return (pins) => ({ ...pins, pinnedProjects: orderedIds(pins.pinnedProjects, order) });
}

/** A device's pinned projects from before the machine kept them, after the machine's own. */
export function adoptedProjectPins(projectIds: readonly string[]): PinChange {
  return (pins) => ({ ...pins, pinnedProjects: [...new Set([...pins.pinnedProjects, ...projectIds])] });
}

/**
 * The reader dragged a pinned list into a new order (R11; owner, 2026-10-08: "pinned is meant to be
 * a fixed place"), applied as `orderedIds` does. A project id orders that project's pins, none the
 * global ones.
 */
export function pinOrder(order: readonly string[], projectId?: string): PinChange {
  return (pins) => projectId === undefined
    ? { ...pins, global: orderedIds(pins.global, order) }
    : { ...pins, projects: withProject(pins.projects, projectId, orderedIds(pins.projects[projectId] ?? [], order)) };
}

/** A deleted session leaves every pin: the global one and each project's. */
export function forgottenPin(sessionId: string): PinChange {
  return (pins) => ({
    ...pins,
    global: pins.global.filter((id) => id !== sessionId),
    projects: Object.fromEntries(Object.entries(pins.projects).map(([projectId, ids]) => [projectId, ids.filter((id) => id !== sessionId)])),
  });
}

function toggled(ids: readonly string[], id: string, pinned: boolean): string[] {
  if (!pinned) return ids.filter((existing) => existing !== id);
  return ids.includes(id) ? [...ids] : [...ids, id];
}

function withProject(projects: Readonly<Record<string, readonly string[]>>, projectId: string, ids: readonly string[]): Record<string, readonly string[]> {
  return { ...projects, [projectId]: ids };
}

function parsePinFile(value: unknown): SessionPins {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid session pin file");
  const pinned: unknown = Reflect.get(value, "pinnedSessionIds");
  if (!Array.isArray(pinned)) throw new Error("Invalid session pin file");
  const pinnedProjectIds: unknown = Reflect.get(value, "pinnedProjectIds");
  return { global: nonEmptyIds(pinned), projects: parseProjectPins(Reflect.get(value, "projectPins")), pinnedProjects: Array.isArray(pinnedProjectIds) ? nonEmptyIds(pinnedProjectIds) : [] };
}

function parseProjectPins(value: unknown): Record<string, readonly string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([projectId, ids]) => (projectId !== "" && Array.isArray(ids) ? [[projectId, nonEmptyIds(ids)]] : [])));
}

function nonEmptyIds(values: readonly unknown[]): string[] {
  return values.filter((id): id is string => typeof id === "string" && id !== "");
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const known = new Set(left);
  return left.length === right.length && right.every((id) => known.has(id));
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => right[index] === id);
}

function samePins(left: SessionPins, right: SessionPins): boolean {
  const projects = new Set([...Object.keys(left.projects), ...Object.keys(right.projects)]);
  return sameIds(left.global, right.global)
    && [...projects].every((projectId) => sameIds(left.projects[projectId] ?? [], right.projects[projectId] ?? []))
    && sameOrder(left.pinnedProjects, right.pinnedProjects);
}

/** The file's shape: a project with no pins left is dropped, and a kind with none at all is left out, as older files have it. */
function pinFile(pins: SessionPins): { pinnedSessionIds: readonly string[]; projectPins?: Record<string, readonly string[]>; pinnedProjectIds?: readonly string[] } {
  const projectPins = Object.fromEntries(Object.entries(pins.projects).filter(([, ids]) => ids.length > 0));
  return {
    pinnedSessionIds: pins.global,
    ...(Object.keys(projectPins).length === 0 ? {} : { projectPins }),
    ...(pins.pinnedProjects.length === 0 ? {} : { pinnedProjectIds: pins.pinnedProjects }),
  };
}

export class SessionPinStore {
  constructor(
    private readonly filePath = sessionPinStorePath(),
    private readonly onChange: () => void = () => undefined,
  ) {}

  private tail: Promise<unknown> = Promise.resolve();

  async read(): Promise<SessionPins> {
    try {
      return parsePinFile(JSON.parse(await readFile(this.filePath, "utf-8")));
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return { global: [], projects: {}, pinnedProjects: [] };
      throw error;
    }
  }

  /** The global pins. */
  async list(): Promise<string[]> {
    return [...(await this.read()).global];
  }

  async apply(change: PinChange): Promise<SessionPins> {
    const run = this.tail.then(async () => {
      const before = await this.read();
      const next = change(before);
      await this.write(next);
      if (!samePins(before, next)) this.onChange();
      return next;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async write(pins: SessionPins): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${String(process.pid)}.tmp`;
    await writeFile(temp, `${JSON.stringify(pinFile(pins), null, 2)}\n`, "utf-8");
    await rename(temp, this.filePath);
  }
}
