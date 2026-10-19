import type { Api, AssistantMessage, Context, Message, Model, StopReason } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PluginGrantedModel, PluginModelPort, PluginModelReasoning, PluginModelReply, PluginModelRequest, PluginModelUsage } from "../../../server-plugin-api.js";
import type { PiWebPluginModelUse } from "../../../shared/apiTypes.js";
import { splitModelRef, type PluginModelGrant } from "../../../shared/pluginModelGrant.js";
import { errorMessage, isRecord } from "../../../shared/unknownValues.js";
import type { PluginModelUsageReport } from "../../shared/workspaces/workspaceCatalog.js";

/**
 * The `models` port: a server plugin calls a model the owner granted it through this machine's
 * model registry and logins (owner-approved 2026-10-19). The plugin never sees
 * a key; the host bounds every call (output tokens, a deadline, calls in flight) and counts what
 * each plugin spent since the daemon started, so the owner can see it on the plugin's card.
 *
 * Plugins activate before the daemon's model runtime exists, so the port closes over a resolver;
 * until the runtime is there every call is refused `not-ready`, never answered empty.
 */

const DEFAULT_MAX_TOKENS = 1024;
const MAX_TOKENS_CAP = 4096;
const DEADLINE_MS = 60_000;
const DEADLINE_PASSED = `The model did not answer within ${String(DEADLINE_MS / 1000)} seconds.`;
const MAX_IN_FLIGHT = 2;

export type PluginModelRuntime = Pick<ModelRuntime, "getModel" | "hasConfiguredAuth" | "completeSimple">;

export interface PluginModelCallLogger {
  info(details: Record<string, unknown>, message: string): void;
}

type Reachability = PluginGrantedModel["state"];

interface Reached {
  readonly kind: "reached";
  readonly runtime: PluginModelRuntime;
  readonly model: Model<Api>;
}

const REASONING: ReadonlySet<string> = new Set<PluginModelReasoning>(["off", "minimal", "low", "medium", "high"]);

/** A text-only call answers when it stops or runs out of tokens; every other stop reason is a failure. */
function answeredStop(reason: StopReason): reason is "stop" | "length" {
  return reason === "stop" || reason === "length";
}

export class PluginModelPorts {
  private readonly usage = new Map<string, Map<string, PiWebPluginModelUse>>();
  private readonly inFlight = new Map<string, number>();

  constructor(
    private readonly runtime: () => PluginModelRuntime | undefined,
    private readonly logger: PluginModelCallLogger,
  ) {}

  /** The port of one plugin, answering only for the models granted to it. */
  portFor(pluginId: string, grant: PluginModelGrant): PluginModelPort {
    const granted = [...new Set(grant)];
    const counted = this.usage.get(pluginId);
    this.usage.set(pluginId, new Map(granted.map((model) => [model, counted?.get(model) ?? emptyUse(model)])));
    return Object.freeze({
      list: () => Promise.resolve(granted.map((model) => this.describe(model))),
      complete: (request: PluginModelRequest, signal: AbortSignal) => this.complete(pluginId, granted, request, signal),
    });
  }

  /** What each plugin with a port spent, per granted model, since the daemon started. */
  report(): readonly PluginModelUsageReport[] {
    return [...this.usage].map(([pluginId, models]) => ({ pluginId, models: [...models.values()].map((use) => ({ ...use })) }));
  }

  private reach(ref: string): Reached | { readonly kind: Exclude<Reachability, "ready"> } {
    const runtime = this.runtime();
    if (runtime === undefined) return { kind: "not-ready" };
    const { provider, id } = splitModelRef(ref);
    const model = runtime.getModel(provider, id);
    if (model === undefined) return { kind: "unknown-model" };
    if (!runtime.hasConfiguredAuth(provider)) return { kind: "no-auth" };
    return { kind: "reached", runtime, model };
  }

  private describe(ref: string): PluginGrantedModel {
    const reached = this.reach(ref);
    if (reached.kind === "reached") return { model: ref, name: reached.model.name, reasoning: reached.model.reasoning, state: "ready" };
    const { provider, id } = splitModelRef(ref);
    const known = this.runtime()?.getModel(provider, id);
    return { model: ref, name: known?.name, reasoning: known?.reasoning, state: reached.kind };
  }

  private async complete(pluginId: string, granted: readonly string[], request: PluginModelRequest, signal: AbortSignal): Promise<PluginModelReply> {
    const invalid = requestProblem(request);
    if (invalid !== undefined) return { kind: "failed", message: `The model request is not valid: ${invalid}` };
    if (!granted.includes(request.model)) return { kind: "refused", reason: "not-granted" };
    const reached = this.reach(request.model);
    if (reached.kind !== "reached") return { kind: "refused", reason: reached.kind };
    const running = this.inFlight.get(pluginId) ?? 0;
    if (running >= MAX_IN_FLIGHT) return { kind: "refused", reason: "busy" };
    this.inFlight.set(pluginId, running + 1);
    const deadline = AbortSignal.timeout(DEADLINE_MS);
    const startedAt = Date.now();
    try {
      const message = await reached.runtime.completeSimple(reached.model, contextOf(request, reached.model), {
        maxTokens: Math.min(request.maxTokens ?? DEFAULT_MAX_TOKENS, MAX_TOKENS_CAP),
        signal: AbortSignal.any([signal, deadline]),
        ...(request.reasoning === undefined || request.reasoning === "off" ? {} : { reasoning: request.reasoning }),
      });
      const reply = replyOf(message, deadline.aborted);
      this.record(pluginId, request.model, message);
      this.logger.info({ pluginId, model: request.model, outcome: reply.kind, inputTokens: message.usage.input, outputTokens: message.usage.output, ms: Date.now() - startedAt }, "plugin model call");
      return reply;
    } catch (error) {
      this.logger.info({ pluginId, model: request.model, outcome: "failed", ms: Date.now() - startedAt }, "plugin model call");
      return { kind: "failed", message: deadline.aborted ? DEADLINE_PASSED : errorMessage(error) };
    } finally {
      this.inFlight.set(pluginId, (this.inFlight.get(pluginId) ?? 1) - 1);
    }
  }

  private record(pluginId: string, model: string, message: AssistantMessage): void {
    const uses = this.usage.get(pluginId);
    const use = uses?.get(model);
    if (uses === undefined || use === undefined) return;
    const cost = reportedCost(message);
    uses.set(model, {
      model,
      calls: use.calls + 1,
      inputTokens: use.inputTokens + message.usage.input,
      outputTokens: use.outputTokens + message.usage.output,
      reportedCostUsd: use.reportedCostUsd + (cost ?? 0),
      unpricedCalls: use.unpricedCalls + (cost === undefined ? 1 : 0),
    });
  }
}

function emptyUse(model: string): PiWebPluginModelUse {
  return { model, calls: 0, inputTokens: 0, outputTokens: 0, reportedCostUsd: 0, unpricedCalls: 0 };
}

/** A cost of zero is what a catalog without prices computes, not a price: it reads as not reported. */
function reportedCost(message: AssistantMessage): number | undefined {
  const total = message.usage.cost.total;
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

/** Plugins are trusted code, but the request may carry what a browser sent: read it at the port's edge. */
function requestProblem(request: unknown): string | undefined {
  if (!isRecord(request)) return "expected an object";
  if (typeof request["model"] !== "string") return "model must be a provider/model-id string";
  if (request["system"] !== undefined && typeof request["system"] !== "string") return "system must be a string";
  const messages = request["messages"];
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty list";
  if (!messages.every((item: unknown) => isRecord(item) && (item["role"] === "user" || item["role"] === "assistant") && typeof item["text"] === "string")) return "each message needs a role (user or assistant) and a text";
  const reasoning = request["reasoning"];
  if (reasoning !== undefined && (typeof reasoning !== "string" || !REASONING.has(reasoning))) return "reasoning must be off, minimal, low, medium or high";
  const maxTokens = request["maxTokens"];
  if (maxTokens !== undefined && (typeof maxTokens !== "number" || !Number.isSafeInteger(maxTokens) || maxTokens < 1)) return "maxTokens must be a positive whole number";
  return undefined;
}

function contextOf(request: PluginModelRequest, model: Model<Api>): Context {
  const timestamp = Date.now();
  const messages: Message[] = request.messages.map((message) => (message.role === "user"
    ? { role: "user", content: message.text, timestamp }
    : { role: "assistant", content: [{ type: "text", text: message.text }], api: model.api, provider: model.provider, model: model.id, usage: noUsage(), stopReason: "stop", timestamp }));
  return { ...(request.system === undefined ? {} : { systemPrompt: request.system }), messages };
}

function noUsage(): AssistantMessage["usage"] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function replyOf(message: AssistantMessage, timedOut: boolean): PluginModelReply {
  const { stopReason } = message;
  if (!answeredStop(stopReason)) {
    if (timedOut) return { kind: "failed", message: DEADLINE_PASSED };
    return { kind: "failed", message: message.errorMessage ?? `The model stopped without an answer (${stopReason}).` };
  }
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  const cost = reportedCost(message);
  const usage: PluginModelUsage = {
    input: message.usage.input,
    output: message.usage.output,
    ...(message.usage.reasoning === undefined ? {} : { reasoning: message.usage.reasoning }),
    ...(cost === undefined ? {} : { costUsd: cost }),
  };
  return { kind: "answered", text, stopReason, usage };
}
