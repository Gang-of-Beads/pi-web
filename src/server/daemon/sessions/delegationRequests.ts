/**
 * Request parsing for the delegation routes (docs/design/no-builtin-agent-tools.md).
 *
 * The retired tools had these checks in their parameter schemas; the routes are
 * the interface now, so the same bounds live here. A malformed request throws, and
 * the route answers 400.
 */
import type { DelegationRequest, SubsessionReadQuery } from "./delegation.js";
import type { TranscriptContentKind, TranscriptRole } from "./subsessionTranscript.js";

const PROMPT_MAX_LENGTH = 100_000;
const MODEL_SPEC_MAX_LENGTH = 256;
const SEARCH_MAX_LENGTH = 1_000;
const ROLES: readonly TranscriptRole[] = ["assistant", "user", "tool", "system", "custom"];
const KINDS: readonly TranscriptContentKind[] = ["text", "thinking", "tool_call", "tool_result", "image"];

export function delegationRequestFromBody(body: Record<string, unknown>): DelegationRequest {
  const prompt = body["prompt"];
  if (typeof prompt !== "string" || prompt.trim() === "") throw new Error("prompt field must be a non-empty string");
  if (prompt.length > PROMPT_MAX_LENGTH) throw new Error("prompt field is too long");
  const model = body["model"];
  if (model !== undefined && (typeof model !== "string" || model === "" || model.length > MODEL_SPEC_MAX_LENGTH)) {
    throw new Error("model field must be a provider/model-id");
  }
  return { prompt, ...(model === undefined ? {} : { model }) };
}

/** The spawn route's target workspace; absent means the spawning session's own. */
export function spawnCwdFromBody(body: Record<string, unknown>): { cwd?: string } {
  const cwd = body["targetCwd"];
  if (cwd === undefined) return {};
  if (typeof cwd !== "string" || cwd === "") throw new Error("targetCwd field must be a non-empty string");
  return { cwd };
}

export interface SubsessionTranscriptQuery {
  roles?: string;
  include?: string;
  search?: string;
  maxChars?: string;
  includeToolArgs?: string;
  before?: string;
  limit?: string;
}

export function subsessionReadQuery(query: SubsessionTranscriptQuery): SubsessionReadQuery {
  const search = query.search;
  if (search !== undefined && search.length > SEARCH_MAX_LENGTH) throw new Error("search query parameter is too long");
  const roles = listOf(query.roles, ROLES, "roles");
  const include = listOf(query.include, KINDS, "include");
  const maxChars = count(query.maxChars, "maxChars", 1);
  const before = count(query.before, "before", 0);
  const limit = count(query.limit, "limit", 1);
  return {
    ...(roles === undefined ? {} : { roles }),
    ...(include === undefined ? {} : { include }),
    ...(search === undefined || search === "" ? {} : { search }),
    ...(maxChars === undefined ? {} : { maxChars }),
    ...(query.includeToolArgs === "true" ? { includeToolArgs: true } : {}),
    ...(before === undefined ? {} : { before }),
    ...(limit === undefined ? {} : { limit }),
  };
}

/** A comma-separated list of known values; an unknown one is refused rather than ignored. */
function listOf<T extends string>(value: string | undefined, known: readonly T[], field: string): T[] | undefined {
  if (value === undefined || value === "") return undefined;
  return value.split(",").map((entry) => {
    const found = known.find((candidate) => candidate === entry.trim());
    if (found === undefined) throw new Error(`${field} query parameter has an unknown value: ${entry}`);
    return found;
  });
}

function count(value: string | undefined, field: string, minimum: number): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${field} query parameter must be an integer of at least ${String(minimum)}`);
  return parsed;
}
