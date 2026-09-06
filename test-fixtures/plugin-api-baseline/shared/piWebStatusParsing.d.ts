import type { PiWebComponentStatus, PiWebDeprecatedAgentInput, PiWebInstallationInfo, PiWebRuntimeComponent, PiWebRuntimeResponse, PiWebVersionResponse } from "./apiTypes.js";
export declare function parsePiWebVersionResponse(value: unknown): PiWebVersionResponse | undefined;
export declare function parsePiWebRuntimeResponse(value: unknown): PiWebRuntimeResponse | undefined;
export declare function parsePiWebRuntimeComponent(value: unknown): PiWebRuntimeComponent | undefined;
/**
 * Parse deprecated agent-configuration inputs reported by another component or
 * machine. The payload only feeds an advisory warning banner, so malformed
 * entries are dropped rather than failing the whole runtime snapshot: a
 * cross-version peer must never blank a machine's runtime over a warning.
 * Returns undefined when the field itself is absent or not an array.
 */
export declare function parseDeprecatedAgentInputs(value: unknown): PiWebDeprecatedAgentInput[] | undefined;
export declare function parsePiWebComponentStatus(value: unknown): PiWebComponentStatus | undefined;
export declare function parsePiWebInstallationInfo(value: unknown): PiWebInstallationInfo | undefined;
