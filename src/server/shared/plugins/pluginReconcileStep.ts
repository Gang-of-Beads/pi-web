/**
 * What a live reconcile does to one server plugin (B19 slice A), decided in one place.
 *
 * A Settings toggle now applies in the running process instead of waiting for a restart. Two
 * changes still wait for one, and say so through the plugin card's "Restart required": a plugin
 * that handed core a face (a workspace provider or a machine registry), because core wired that
 * face in at boot (owner question 22); and a new revision of a running plugin, which the slice
 * does not swap live.
 */
export type ReconcileStep = "keep" | "enable" | "disable" | "awaits-restart";

export interface ReconcileFacts {
  /** The catalog wants this plugin running (enabled, allowed by safe start, still installed). */
  readonly wanted: boolean;
  /** Undefined when the plugin is not running in this process. */
  readonly active: { readonly hasFace: boolean; readonly revision: string } | undefined;
  /** The catalog's revision of the plugin's server module, when it is still installed. */
  readonly desiredRevision: string | undefined;
}

export function reconcileStep(facts: ReconcileFacts): ReconcileStep {
  const { wanted, active } = facts;
  if (active === undefined) return wanted ? "enable" : "keep";
  if (active.hasFace) return wanted && facts.desiredRevision === active.revision ? "keep" : "awaits-restart";
  if (!wanted) return "disable";
  return facts.desiredRevision === active.revision ? "keep" : "awaits-restart";
}
