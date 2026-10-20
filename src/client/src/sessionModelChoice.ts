import type { SessionModel } from "./api";

/**
 * Whether a session has a model to run with. pi's SDK fills an unset model with a placeholder
 * whose provider and id are both "unknown" (pi-agent-core's DEFAULT_MODEL), and a daemon passes it
 * on as it is; it reached the composer as "unknown/unknown" on a phone with no model configured
 * (owner report, 2026-10-20). The placeholder and an absent model both mean none is configured.
 * Only a status that was read can say so: before it is read, nothing is drawn at all.
 */
export type SessionModelChoice =
  | { readonly kind: "chosen"; readonly provider: string; readonly id: string }
  | { readonly kind: "not-configured" };

const SDK_UNSET_MODEL = "unknown";

export function sessionModelChoice(model: Pick<SessionModel, "provider" | "id"> | undefined): SessionModelChoice {
  const id = model?.id ?? "";
  const provider = model?.provider ?? "";
  if (id === "" || (id === SDK_UNSET_MODEL && provider === SDK_UNSET_MODEL)) return { kind: "not-configured" };
  return { kind: "chosen", provider, id };
}
