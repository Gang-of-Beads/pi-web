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

export interface AgentFactDeclarations {
  readonly surfaces: readonly AgentSurfaceDeclaration[];
  readonly injectedTurns: readonly InjectedTurnDeclaration[];
}

export class InvalidAgentFactDeclarationError extends Error {}

export function parseAgentFactDeclarations(value: unknown): AgentFactDeclarations | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new InvalidAgentFactDeclarationError("Agent fact declarations must be an object");
  return {
    surfaces: parseSurfaces(value["surfaces"]),
    injectedTurns: parseInjectedTurns(value["injectedTurns"]),
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
