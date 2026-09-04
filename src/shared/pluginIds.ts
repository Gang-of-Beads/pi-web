export const piWebPluginIdPattern = /^[a-z][a-z0-9.-]*$/u;

/**
 * Ids the host mints itself, which a discovered package may not claim.
 *
 * "themes" was reserved while the theme pack was app code registered under
 * that name. The pack ships as a plugin now, so reserving the name would stop
 * the shipped themes from loading at all; the id stays spelled the same so
 * every saved preference like "themes:clay-paper" keeps resolving.
 */
const reservedPiWebPluginIds = new Set(["core"]);
const machinePluginIdPrefix = "machine.";

export function isPiWebPluginId(value: string): boolean {
  return piWebPluginIdPattern.test(value);
}

export function isReservedPiWebPluginId(value: string): boolean {
  return reservedPiWebPluginIds.has(value) || value.startsWith(machinePluginIdPrefix);
}
