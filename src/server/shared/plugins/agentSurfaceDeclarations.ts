/**
 * What a plugin says about the agent-side facts its own feature produces.
 *
 * Two of these lived in the daemon as constants: the tool names that prove a
 * goals surface is worth showing, and the marker a goal continuation turn
 * carries. Both are facts about a feature, not about the host, and the host
 * had to be edited whenever the feature changed - which is the coupling the
 * plugin boundary exists to remove.
 *
 * Surfaces are named by tool rather than by package because a fork, a rename
 * or a local checkout provides the surface just as well; one tool is enough,
 * since a plugin registering a subset still has something behind its panel.
 */
import { isRecord } from "../../../shared/unknownValues.js";

export interface AgentSurfaceDeclaration {
  /** The surface a browser panel asks about. */
  readonly surface: string;
  /** Any one of these tools proves the surface is backed. */
  readonly tools: readonly string[];
}

export interface InjectedTurnDeclaration {
  readonly id: string;
  /** The literal marker anchored at the start of the injected text. */
  readonly marker: string;
  readonly producer: string;
}

/**
 * Where a work path is anchored: the session's working directory, the directory holding its
 * transcript, or the directory named after the transcript file (where a tool keeps one session's
 * runs).
 */
export type WorkPathRoot = "cwd" | "session-dir" | "session-stem";

/** Whether a root may be declared on its own: a session's own run directory may, a whole workspace or session directory may not. */
const WORK_PATH_ROOTS: Readonly<Record<WorkPathRoot, { readonly bareAllowed: boolean }>> = {
  cwd: { bareAllowed: false },
  "session-dir": { bareAllowed: false },
  "session-stem": { bareAllowed: true },
};

/** A directory the feature's extension writes background work into, relative to its root. */
export interface WorkPathDeclaration {
  readonly root: WorkPathRoot;
  readonly path: string;
}

export interface AgentFactDeclarations {
  readonly surfaces: readonly AgentSurfaceDeclaration[];
  readonly injectedTurns: readonly InjectedTurnDeclaration[];
  /**
   * Directories the feature's extension writes background work into (B20): the daemon watches
   * them to recount a session's background work, and the workspace watcher ignores those under
   * `cwd` as churn.
   */
  readonly workPaths: readonly WorkPathDeclaration[];
}

export class InvalidAgentFactDeclarationError extends Error {}

export function parseAgentFactDeclarations(value: unknown): AgentFactDeclarations | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new InvalidAgentFactDeclarationError("Agent fact declarations must be an object");
  return {
    surfaces: parseSurfaces(value["surfaces"]),
    injectedTurns: parseInjectedTurns(value["injectedTurns"]),
    workPaths: parseWorkPaths(value["workPaths"]),
  };
}

function parseWorkPaths(value: unknown): readonly WorkPathDeclaration[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidAgentFactDeclarationError("Declared work paths must be an array");
  return value.map((entry) => {
    if (!isRecord(entry)) throw new InvalidAgentFactDeclarationError("A declared work path must be an object");
    const root = entry["root"];
    const path = entry["path"];
    if (!isWorkPathRoot(root)) throw new InvalidAgentFactDeclarationError("A declared work path needs a root: cwd, session-dir or session-stem");
    if (typeof path !== "string") throw new InvalidAgentFactDeclarationError(`Declared work path under ${root} needs a path`);
    if (isBareRelativePath(path) && !WORK_PATH_ROOTS[root].bareAllowed) throw new InvalidAgentFactDeclarationError(`A declared work path cannot be the whole ${root}`);
    if (!isContainedRelativePath(path)) throw new InvalidAgentFactDeclarationError(`Declared work path ${path} must stay inside its root`);
    return { root, path };
  });
}

function isWorkPathRoot(value: unknown): value is WorkPathRoot {
  return typeof value === "string" && Object.hasOwn(WORK_PATH_ROOTS, value);
}

function isBareRelativePath(path: string): boolean {
  return path.replaceAll("\\", "/").split("/").every((segment) => segment === "" || segment === ".");
}

function isContainedRelativePath(path: string): boolean {
  const segments = path.replaceAll("\\", "/").split("/");
  return !path.startsWith("/") && !/^[A-Za-z]:/u.test(path) && !segments.includes("..");
}

function parseSurfaces(value: unknown): readonly AgentSurfaceDeclaration[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidAgentFactDeclarationError("Declared surfaces must be an array");
  return value.map((entry) => {
    if (!isRecord(entry)) throw new InvalidAgentFactDeclarationError("A declared surface must be an object");
    const surface = entry["surface"];
    const tools = entry["tools"];
    if (typeof surface !== "string" || surface === "") throw new InvalidAgentFactDeclarationError("A declared surface needs a name");
    if (!Array.isArray(tools) || tools.length === 0 || !isToolList(tools)) {
      throw new InvalidAgentFactDeclarationError(`Declared surface ${surface} needs the tools that back it`);
    }
    return { surface, tools };
  });
}

function parseInjectedTurns(value: unknown): readonly InjectedTurnDeclaration[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidAgentFactDeclarationError("Declared injected turns must be an array");
  return value.map((entry) => {
    if (!isRecord(entry)) throw new InvalidAgentFactDeclarationError("A declared injected turn must be an object");
    const id = entry["id"];
    const marker = entry["marker"];
    const producer = entry["producer"];
    if (typeof id !== "string" || id === "") throw new InvalidAgentFactDeclarationError("A declared injected turn needs an id");
    if (typeof marker !== "string" || marker === "") throw new InvalidAgentFactDeclarationError(`Declared injected turn ${id} needs its marker`);
    if (typeof producer !== "string" || producer === "") throw new InvalidAgentFactDeclarationError(`Declared injected turn ${id} needs its producer`);
    return { id, marker, producer };
  });
}

function isToolList(value: readonly unknown[]): value is string[] {
  return value.every((tool) => typeof tool === "string" && tool !== "");
}
