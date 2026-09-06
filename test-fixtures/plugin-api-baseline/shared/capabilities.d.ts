import { PI_WEB_CAPABILITIES, type PiWebCapability, type PiWebRuntimeComponent, type PiWebServiceComponent } from "./apiTypes.js";
export { PI_WEB_CAPABILITIES };
export type { PiWebCapability };
export declare const KNOWN_PI_WEB_CAPABILITIES: PiWebCapability[];
export declare const WEB_RUNTIME_CAPABILITIES: readonly ["plugins.lifecycle"];
export declare const SESSIOND_RUNTIME_CAPABILITIES: readonly [];
export declare function isPiWebCapability(value: unknown): value is PiWebCapability;
export declare function supportsPiWebCapability(source: {
    capabilities?: readonly PiWebCapability[];
} | undefined, capability: PiWebCapability): boolean;
export declare function parseKnownPiWebCapabilities(value: unknown): PiWebCapability[] | undefined;
export declare function effectivePiWebCapabilities(components: Partial<Record<PiWebServiceComponent, Pick<PiWebRuntimeComponent, "available" | "capabilities">>>): PiWebCapability[];
