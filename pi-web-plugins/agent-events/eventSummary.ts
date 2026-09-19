/**
 * One honest line for the agent's own tool bookkeeping.
 *
 * Web searches, browser sessions and account selections are written into the
 * transcript as custom messages. Nobody claimed those tags, so each drew
 * "Unrecognized message" - a defect notice for a message that was fine. These
 * summaries state what the entry is and what it names, and say nothing they
 * were not given.
 */

export interface AgentEventSummary {
  title: string;
  detail: string | undefined;
}

const TITLES: Record<string, string> = {
  "web-search-results": "Web search",
  "agent-browser-script-session": "Browser session",
  "pi-accounts-selection": "Account selection",
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function urlCount(payload: unknown): number | undefined {
  if (!isRecord(payload)) return undefined;
  const metadata = payload["urlMetadata"];
  return Array.isArray(metadata) ? metadata.length : undefined;
}

function firstTitle(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const metadata = payload["urlMetadata"];
  if (!Array.isArray(metadata)) return undefined;
  const first: unknown = metadata[0];
  if (!isRecord(first)) return undefined;
  const title = first["title"] ?? first["url"];
  return typeof title === "string" && title !== "" ? title : undefined;
}

function pickedProviders(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const providers = payload["providers"];
  if (!isRecord(providers)) return undefined;
  const chosen = Object.entries(providers)
    .filter(([, account]) => typeof account === "string" && account !== "")
    .map(([provider, account]) => `${provider}: ${String(account)}`);
  return chosen.length === 0 ? undefined : chosen.join(", ");
}

function sessionName(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const name = payload["sessionName"];
  const cleanup = payload["cleanup"];
  const parts = [typeof name === "string" && name !== "" ? name : undefined, typeof cleanup === "string" && cleanup !== "" ? cleanup : undefined]
    .filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

export function agentEventSummary(tag: string, payload: unknown): AgentEventSummary {
  const title = TITLES[tag] ?? "Agent event";
  if (tag === "web-search-results") {
    const count = urlCount(payload);
    const lead = firstTitle(payload);
    const parts = [count === undefined ? undefined : `${String(count)} source${count === 1 ? "" : "s"}`, lead]
      .filter((part): part is string => part !== undefined);
    return { title, detail: parts.length === 0 ? undefined : parts.join(" · ") };
  }
  if (tag === "agent-browser-script-session") return { title, detail: sessionName(payload) };
  if (tag === "pi-accounts-selection") return { title, detail: pickedProviders(payload) };
  return { title, detail: undefined };
}
