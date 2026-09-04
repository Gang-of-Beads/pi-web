import type { AgentFactDeclarations } from "../../shared/plugins/agentSurfaceDeclarations.js";

/**
 * What the plugins loaded in this daemon declare about the agent-side features
 * they front.
 *
 * The daemon reads these while answering about a session, which happens far
 * from where the plugin runtime is built, and the runtime is activated once at
 * startup. Rather than threading a provider through every construction path
 * that only ever has one answer, the daemon records the declarations once and
 * the readers ask here.
 *
 * Nothing declared is a legitimate state: a machine with no goals plugin
 * declares no goals surface, and a reader must treat that as "not backed"
 * rather than as an error.
 */

const empty: AgentFactDeclarations = { surfaces: [], injectedTurns: [] };

let declared: AgentFactDeclarations = empty;

export function recordDeclaredAgentFacts(facts: AgentFactDeclarations): void {
  declared = facts;
}

export function declaredAgentFacts(): AgentFactDeclarations {
  return declared;
}

export function declaredSurfaceTools(surface: string): readonly string[] {
  return declared.surfaces.find((entry) => entry.surface === surface)?.tools ?? [];
}

export function resetDeclaredAgentFacts(): void {
  declared = empty;
}
