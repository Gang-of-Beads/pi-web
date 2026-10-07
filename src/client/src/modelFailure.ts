import type { AssistantMessage } from "@earendil-works/pi-ai";
import { isContextOverflow } from "@earendil-works/pi-ai/utils/overflow";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";

/**
 * What ended a reply in an error, as pi itself classifies it (B34).
 *
 * A provider error reaches PI WEB as text only (`errorMessage`, which pi writes as "<status>: <body>"),
 * so any classification is a reading of that text. PI WEB does not keep its own patterns: it asks pi's
 * public classifiers, the ones pi's own auto-retry and compaction decide with
 * (`@earendil-works/pi-ai/utils/retry` and `/utils/overflow`), so a pi upgrade that learns a provider's
 * wording upgrades this row too (owner, 2026-10-07: "可以直接用pi的实现"). The provider's text itself is
 * shown whole behind Details, never parsed.
 */
export type ModelFailure = "transient" | "overflow" | "provider";

const NO_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function modelFailure(errorMessage: string, provider: string | undefined): ModelFailure {
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: "pi-messages",
    provider: provider ?? "",
    model: "",
    usage: NO_USAGE,
    stopReason: "error",
    errorMessage,
    timestamp: 0,
  };
  if (isContextOverflow(message)) return "overflow";
  return isRetryableAssistantError(message) ? "transient" : "provider";
}

/** The row's sentence per kind; no Retry is offered, sending a message is the retry (owner, 2026-10-07). */
export const MODEL_FAILURE_SENTENCE: Readonly<Record<ModelFailure, string>> = {
  transient: "The model provider had a temporary error. Send a message to try again.",
  overflow: "The conversation is too long for this model. Send a message to try again.",
  provider: "The model provider returned an error. Send a message to try again.",
};
