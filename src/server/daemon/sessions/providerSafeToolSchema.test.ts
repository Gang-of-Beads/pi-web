import { describe, expect, it } from "vitest";
import { applyProviderSafeToolSchemas, stripUnsupportedToolSchemaBounds } from "./providerSafeToolSchema";

/**
 * Owner report: "Model response failed: 400 … tools.44.custom: For 'integer'
 * type, properties maximum, minimum are not supported" - every turn in the
 * session died, and the tool count is irrelevant to Anthropic: one bounded
 * integer property anywhere fails the whole request.
 */
describe("schema keywords Anthropic refuses", () => {
  it("drops the bounds on an integer and keeps the rest", () => {
    const schema = {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "how many" } },
      required: ["limit"],
    };

    expect(stripUnsupportedToolSchemaBounds(schema)).toBe(2);
    expect(schema).toEqual({
      type: "object",
      properties: { limit: { type: "integer", description: "how many" } },
      required: ["limit"],
    });
  });

  it("keeps bounds on a number, where Anthropic accepts them", () => {
    const schema = { type: "number", minimum: 0, maximum: 1 };
    expect(stripUnsupportedToolSchemaBounds(schema)).toBe(0);
    expect(schema).toEqual({ type: "number", minimum: 0, maximum: 1 });
  });

  it("reaches bounds nested in arrays, unions and objects", () => {
    const schema = {
      type: "object",
      properties: {
        rows: { type: "array", items: { type: "integer", minimum: 0 } },
        pick: { anyOf: [{ type: "integer", maximum: 3 }, { type: "string" }] },
        nested: { type: "object", properties: { deep: { type: "integer", minimum: 2 } } },
      },
    };

    expect(stripUnsupportedToolSchemaBounds(schema)).toBe(3);
    expect(JSON.stringify(schema)).not.toContain("minimum");
    expect(JSON.stringify(schema)).not.toContain("maximum");
  });

  it("leaves a parameter that is literally named minimum alone", () => {
    const schema = { type: "object", properties: { minimum: { type: "integer", minimum: 0 } } };
    stripUnsupportedToolSchemaBounds(schema);
    expect(schema).toEqual({ type: "object", properties: { minimum: { type: "integer" } } });
  });
});

describe("applying it to a session's tools", () => {
  const host = (definitions: Record<string, unknown>) => ({
    getAllTools: () => Object.keys(definitions).map((name) => ({ name, parameters: definitions[name] })),
    getToolDefinition: (name: string) => (definitions[name] === undefined ? undefined : { parameters: definitions[name] }),
  });

  it("counts only the schemas it actually rewrote", () => {
    const definitions: Record<string, unknown> = {
      read_subsession: { type: "object", properties: { limit: { type: "integer", minimum: 1 } } },
      read: { type: "object", properties: { path: { type: "string" } } },
    };

    expect(applyProviderSafeToolSchemas(host(definitions))).toBe(1);
    expect(JSON.stringify(definitions["read_subsession"])).not.toContain("minimum");
  });

  it("rewrites the schema object the request already holds, not a copy of it", () => {
    const parameters = { type: "object", properties: { limit: { type: "integer", minimum: 1 } } };
    const definitions: Record<string, unknown> = { read_subsession: parameters };
    const heldByRegistry = parameters;

    applyProviderSafeToolSchemas(host(definitions));

    expect(heldByRegistry).toBe(parameters);
    expect(JSON.stringify(heldByRegistry)).not.toContain("minimum");
  });

  it("is idempotent, so running it again after a reload costs nothing", () => {
    const definitions: Record<string, unknown> = { tool: { type: "integer", minimum: 0 } };
    const shared = host(definitions);
    applyProviderSafeToolSchemas(shared);
    expect(applyProviderSafeToolSchemas(shared)).toBe(0);
  });
});

describe("the tool that actually failed", () => {
  it("stops sending read_subsession's integer bounds", async () => {
    const { createSubsessionToolDefinitions } = await import("./spawnSubsessionTool");
    const definitions = createSubsessionToolDefinitions("/tmp", {
      spawn: () => Promise.resolve({ sessionId: "x", cwd: "/tmp" }),
      list: () => Promise.resolve([]),
      check: () => Promise.resolve({ sessionId: "x", cwd: "/tmp", status: "idle" as const, finalText: "", messageCount: 0 }),
      read: () => Promise.resolve({ sessionId: "x", cwd: "/tmp", status: "idle" as const, entries: [], total: 0, matched: 0, start: 0, hasMore: false }),
    });
    const readTool = definitions.find((definition) => definition.name === "read_subsession");
    if (readTool === undefined) throw new Error("read_subsession is gone; the tool this bug was reported against moved");
    const parameters: unknown = readTool.parameters;

    const before = JSON.stringify(parameters);
    expect(before, "read_subsession no longer carries bounds, so this guard stopped meaning anything").toContain("minimum");

    const tools = definitions.map((definition): { name: string; parameters: unknown } => ({ name: definition.name, parameters: definition.parameters }));
    expect(applyProviderSafeToolSchemas({
      getAllTools: () => tools,
      getToolDefinition: (name) => tools.find((definition) => definition.name === name),
    })).toBeGreaterThan(0);

    expect(JSON.stringify(parameters)).not.toContain("minimum");
  });
});
