/**
 * What a subagent run was running on.
 *
 * A run records its model as one string - `provider/model:thinking`, for
 * example "anthropic-merchant/claude-opus-5:medium". The rows showed none of
 * it, so a fleet of running agents gave no way to tell which was on which
 * model, or at what thinking level: the two things that decide what a run
 * costs and how long it takes.
 *
 * Only the first slash separates the provider, because some model ids carry a
 * path-like tail of their own.
 */
export interface RunModelIdentity {
  readonly provider?: string;
  readonly model: string;
  readonly thinking?: string;
  /** What a row shows: the model, and the thinking level when there is one. */
  readonly label: string;
}

export function describeRunModel(recorded: string | undefined): RunModelIdentity | undefined {
  const raw = recorded?.trim();
  if (raw === undefined || raw === "") return undefined;

  const slash = raw.indexOf("/");
  const provider = slash === -1 ? undefined : raw.slice(0, slash);
  const rest = slash === -1 ? raw : raw.slice(slash + 1);

  const colon = rest.lastIndexOf(":");
  const model = colon === -1 ? rest : rest.slice(0, colon);
  const thinking = colon === -1 ? undefined : rest.slice(colon + 1);
  if (model === "") return undefined;

  return {
    ...(provider === undefined || provider === "" ? {} : { provider }),
    model,
    ...(thinking === undefined || thinking === "" ? {} : { thinking }),
    label: thinking === undefined || thinking === "" ? model : `${model} · ${thinking}`,
  };
}
