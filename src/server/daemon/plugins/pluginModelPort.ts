import type { Api, AssistantMessage, Context, Message, Model, StopReason, ToolCall } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PluginGrantedModel, PluginModelDroppedToolCall, PluginModelPort, PluginModelReasoning, PluginModelReply, PluginModelRequest, PluginModelTool, PluginModelToolCall, PluginModelUsage } from "../../../server-plugin-api.js";
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
 *
 * Tool calls (owner decision 2026-10-19) give a plugin structured actions without a JSON
 * protocol in the text. The host only offers the plugin's tools and hands the calls back: it never
 * runs a tool and never loops, so one call stays one answer under the same bounds.
 */

const DEFAULT_MAX_TOKENS = 1024;
const MAX_TOKENS_CAP = 4096;
const DEADLINE_MS = 60_000;
const DEADLINE_PASSED = `The model did not answer within ${String(DEADLINE_MS / 1000)} seconds.`;
const MAX_IN_FLIGHT = 2;
const DEADLINE = "deadline";
const MAX_TOOLS = 8;
const MAX_TOOL_DESCRIPTION_CHARS = 1024;
const MAX_TOOL_PARAMETERS_BYTES = 8192;
const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/**
 * Settles at the deadline whether or not the provider honours the abort: a provider that ignores
 * the signal and never settles would otherwise keep the plugin's call pending and hold one of its
 * slots for good. The slot is freed when the call answers, once; a reply that arrives later is
 * still counted in the usage, once, because it was spent.
 */
function deadlinePassed(deadline: AbortSignal): Promise<typeof DEADLINE> {
  return new Promise((resolve) => { deadline.addEventListener("abort", () => { resolve(DEADLINE); }, { once: true }); });
}

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

/**
 * A call answers when it stops, runs out of tokens or, having offered tools, stops for its tool
 * calls; every other stop reason is a failure, so a plugin that offers no tools never sees `toolUse`.
 */
function answeredStop(reason: StopReason, toolsOffered: boolean): reason is "stop" | "length" | "toolUse" {
  return reason === "stop" || reason === "length" || (toolsOffered && reason === "toolUse");
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
    if (!toolsWithinBounds(request.tools ?? [])) return { kind: "refused", reason: "tools-out-of-bounds" };
    if (!granted.includes(request.model)) return { kind: "refused", reason: "not-granted" };
    const reached = this.reach(request.model);
    if (reached.kind !== "reached") return { kind: "refused", reason: reached.kind };
    const running = this.inFlight.get(pluginId) ?? 0;
    if (running >= MAX_IN_FLIGHT) return { kind: "refused", reason: "busy" };
    this.inFlight.set(pluginId, running + 1);
    const deadline = AbortSignal.timeout(DEADLINE_MS);
    const startedAt = Date.now();
    try {
      const call = reached.runtime.completeSimple(reached.model, contextOf(request, reached.model), {
        maxTokens: Math.min(request.maxTokens ?? DEFAULT_MAX_TOKENS, MAX_TOKENS_CAP),
        signal: AbortSignal.any([signal, deadline]),
        ...(request.reasoning === undefined || request.reasoning === "off" ? {} : { reasoning: request.reasoning }),
      }).then((message) => {
        this.record(pluginId, request.model, message);
        return message;
      });
      const message = await Promise.race([call, deadlinePassed(deadline)]);
      if (message === DEADLINE) {
        this.logger.info({ pluginId, model: request.model, outcome: "failed", ms: Date.now() - startedAt }, "plugin model call");
        return { kind: "failed", message: DEADLINE_PASSED };
      }
      const reply = replyOf(message, deadline.aborted, request.tools);
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
  const tools = request["tools"];
  if (tools !== undefined && (!Array.isArray(tools) || !tools.every(isToolShape))) return "tools must be a list of { name, description, parameters }, with parameters an object JSON Schema in plain JSON";
  return undefined;
}

function isToolShape(item: unknown): boolean {
  if (!isRecord(item) || typeof item["name"] !== "string" || typeof item["description"] !== "string") return false;
  const parameters = item["parameters"];
  return isRecord(parameters) && parameters["type"] === "object" && jsonBytes(parameters) !== undefined;
}

function jsonBytes(value: unknown): number | undefined {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? Buffer.byteLength(text) : undefined;
  } catch {
    return undefined;
  }
}

function toolsWithinBounds(tools: readonly PluginModelTool[]): boolean {
  return tools.length <= MAX_TOOLS
    && new Set(tools.map((tool) => tool.name)).size === tools.length
    && tools.every((tool) => TOOL_NAME.test(tool.name)
      && tool.description.length <= MAX_TOOL_DESCRIPTION_CHARS
      && (jsonBytes(tool.parameters) ?? Infinity) <= MAX_TOOL_PARAMETERS_BYTES);
}

function contextOf(request: PluginModelRequest, model: Model<Api>): Context {
  const timestamp = Date.now();
  const messages: Message[] = request.messages.map((message) => (message.role === "user"
    ? { role: "user", content: message.text, timestamp }
    : { role: "assistant", content: [{ type: "text", text: message.text }], api: model.api, provider: model.provider, model: model.id, usage: noUsage(), stopReason: "stop", timestamp }));
  const tools = request.tools ?? [];
  return {
    ...(request.system === undefined ? {} : { systemPrompt: request.system }),
    messages,
    ...(tools.length === 0 ? {} : { tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) }),
  };
}

function noUsage(): AssistantMessage["usage"] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

type ToolCallVerdict = "kept" | PluginModelDroppedToolCall["reason"];

/**
 * The host guarantees only that a call names an offered tool and carries the arguments the model
 * sent as an object. Some adapters (Google's) pass a model's arguments through unparsed, so an array
 * or a scalar is dropped here as unreadable rather than handed on.
 */
function toolCallVerdict(call: ToolCall, offered: ReadonlySet<string>): ToolCallVerdict {
  if (!offered.has(call.name)) return "not-offered";
  if (call.argumentsError !== undefined || !isRecord(call.arguments)) return "unreadable-arguments";
  return "kept";
}

function toolCallsOf(message: AssistantMessage, tools: readonly PluginModelTool[] | undefined): Pick<Extract<PluginModelReply, { kind: "answered" }>, "toolCalls" | "droppedToolCalls"> {
  const offered = new Set((tools ?? []).map((tool) => tool.name));
  const kept: PluginModelToolCall[] = [];
  const dropped: PluginModelDroppedToolCall[] = [];
  for (const call of message.content.flatMap((part) => (part.type === "toolCall" ? [part] : []))) {
    const verdict = toolCallVerdict(call, offered);
    if (verdict === "kept") kept.push({ name: call.name, arguments: call.arguments });
    else dropped.push({ name: call.name, reason: verdict });
  }
  return {
    ...(offered.size === 0 ? {} : { toolCalls: kept }),
    ...(dropped.length === 0 ? {} : { droppedToolCalls: dropped }),
  };
}

function replyOf(message: AssistantMessage, timedOut: boolean, tools: readonly PluginModelTool[] | undefined): PluginModelReply {
  const { stopReason } = message;
  const toolsOffered = (tools ?? []).length > 0;
  if (!answeredStop(stopReason, toolsOffered)) {
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
  return { kind: "answered", text, stopReason, usage, ...toolCallsOf(message, tools) };
}
