/**
 * The tool schemas we hand a provider, minus what its validator refuses.
 *
 * Anthropic's current API rejects `minimum`/`maximum` on an `integer` property
 * outright: "tools.44.custom: For 'integer' type, properties maximum, minimum
 * are not supported". The bounds came from our own tools (the number-of-chars,
 * before and limit arguments of read_subsession), and the failure is per
 * session, not per tool - one bounded property anywhere in a 45-tool list
 * fails every turn with a 400 and an assistant message that never arrives.
 *
 * Producers are plural (our tools, extension tools, MCP servers), so this
 * normalises at the boundary instead of at each declaration. Bounds are a hint
 * to the model, not a validation contract: arguments are still checked against
 * the tool's own schema locally, and the two tools whose ranges matter
 * re-validate their inputs anyway.
 *
 * The rewrite is IN PLACE, and every level of it: `AgentSession` snapshots each
 * definition's schema into its tool registry when it is built, so replacing the
 * definition's `parameters` with a fresh object leaves the registry - and
 * therefore the request - on the old one. Mutating the nodes themselves is what
 * reaches the wire.
 */

const SCHEMA_VALUE_KEYS = ["properties", "patternProperties", "$defs", "definitions"];
const SCHEMA_LIST_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"];
const SCHEMA_CHILD_KEYS = ["items", "additionalProperties", "not", "contains", "propertyNames"];

/** How many keywords were removed, so a caller can tell a rewrite from a no-op. */
export function stripUnsupportedToolSchemaBounds(node: unknown): number {
  if (Array.isArray(node)) return total(node);
  if (!isRecord(node)) return 0;

  let removed = 0;
  if (node["type"] === "integer") {
    if (node["minimum"] !== undefined) { delete node["minimum"]; removed += 1; }
    if (node["maximum"] !== undefined) { delete node["maximum"]; removed += 1; }
    if (node["exclusiveMinimum"] !== undefined) { delete node["exclusiveMinimum"]; removed += 1; }
    if (node["exclusiveMaximum"] !== undefined) { delete node["exclusiveMaximum"]; removed += 1; }
    if (node["multipleOf"] !== undefined) { delete node["multipleOf"]; removed += 1; }
  }
  for (const key of SCHEMA_VALUE_KEYS) {
    const bag = node[key];
    if (!isRecord(bag)) continue;
    for (const value of Object.values(bag)) removed += stripUnsupportedToolSchemaBounds(value);
  }
  for (const key of SCHEMA_LIST_KEYS) removed += total(node[key]);
  for (const key of SCHEMA_CHILD_KEYS) removed += stripUnsupportedToolSchemaBounds(node[key]);
  return removed;
}

/** The part of a session this needs: what it registers, and the live definitions behind it. */
export interface ToolSchemaHost {
  getAllTools(): readonly { name: string; parameters?: unknown }[];
  getToolDefinition(name: string): { parameters: unknown } | undefined;
}

export function applyProviderSafeToolSchemas(host: ToolSchemaHost): number {
  let changed = 0;
  for (const tool of host.getAllTools()) {
    const definition = host.getToolDefinition(tool.name);
    if (definition === undefined) continue;
    if (stripUnsupportedToolSchemaBounds(definition.parameters) > 0) changed += 1;
  }
  return changed;
}

function total(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  let removed = 0;
  for (const entry of value) removed += stripUnsupportedToolSchemaBounds(entry);
  return removed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
