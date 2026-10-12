/**
 * pi's built-in extensions, as the pi CLI loads them.
 *
 * The CLI adds its built-in extensions to every session's extension factories; the SDK leaves
 * them to its host. A session PI WEB created therefore had no `codemode` tool even with
 * `"defaultTools": ["+codemode"]` ("Tool codemode not found", owner, 2026-10-12). Each entry
 * keeps the CLI's flags: `builtin`, so it loads as the `builtin:<name>` resource that pi's
 * `extensions` setting can disable, and `replaceable`, so an extension registering the same tool
 * or command takes over. The tools stay registered inactive, as in pi: the operator's
 * `defaultTools` setting turns them on.
 *
 * The SDK exports codemode, tool search and MCP. The CLI's llama.cpp extension is not exported,
 * so it is not here.
 */
import { createCodemodeExtension, createMcpExtension, createToolSearchExtension, type InlineExtension } from "@earendil-works/pi-coding-agent";

/** The built-in extensions PI WEB loads into every session when the operator has not turned them off. */
export function piBuiltInExtensions(): readonly InlineExtension[] {
  return [
    { name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true },
    { name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
    { name: "mcp", factory: createMcpExtension(), replaceable: true, builtin: true },
  ];
}
