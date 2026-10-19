/**
 * `plugins.<id>.models`: the exact `provider/model-id` names the owner lets one plugin call
 * through the daemon's model registry. An exact list, the way a model is named everywhere else,
 * so the owner reads what a plugin may spend at a glance. Consent, not a wall: server plugins
 * are trusted in-process code.
 */
export type PluginModelGrant = readonly string[];

const MODEL_REF = /^[^/\s]+\/\S+$/u;

export function isPluginModelGrant(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string" && MODEL_REF.test(item));
}

/** A granted name split at its first slash: a model id may itself contain slashes. */
export function splitModelRef(ref: string): { readonly provider: string; readonly id: string } {
  const slash = ref.indexOf("/");
  return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}
