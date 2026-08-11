import { isIP } from "node:net";

export interface SafeTunnelMutationHostConfig {
  /** The operator-selected web listener host. */
  readonly listenerHost?: string;
  /** Exact configured hostnames; `true` deliberately does not trust arbitrary DNS names. */
  readonly allowedHosts?: readonly string[] | true;
}

export interface SafeTunnelMutationHostHeaders {
  readonly host?: string | readonly string[] | undefined;
  readonly origin?: string | readonly string[] | undefined;
}

export interface SafeTunnelMutationHostBoundary {
  allows(
    headers: SafeTunnelMutationHostHeaders,
    registeredPublicHostname: () => Promise<string | undefined>,
  ): Promise<boolean>;
}

/**
 * Builds the feature-local Host/Origin boundary for Safe Tunnel mutations.
 * DNS names become trusted only through startup configuration or a persisted
 * registration; equality between request-controlled Host and Origin is never
 * itself evidence of trust.
 */
export function createSafeTunnelMutationHostBoundary(
  config: SafeTunnelMutationHostConfig = {},
): SafeTunnelMutationHostBoundary {
  const allowedHosts = config.allowedHosts === undefined
    || config.allowedHosts === true
    ? []
    : config.allowedHosts;
  const configuredHostnames = new Set(
    [config.listenerHost, ...allowedHosts].flatMap((value) => {
      const hostname = normalizeConfiguredHostname(value);
      return hostname === undefined ? [] : [hostname];
    }),
  );

  return {
    allows: async (headers, registeredPublicHostname) => {
      const host = requestAuthorityHostname(headers.host);
      if (host === undefined) return false;

      const origin = headers.origin === undefined
        ? undefined
        : requestOriginHostname(headers.origin);
      if (origin === undefined) return false;

      const requestedHostnames = [...new Set([host, origin])];
      const namesRequiringRegistration = requestedHostnames.filter((hostname) => (
        !isIntrinsicallyTrustedHostname(hostname)
        && !configuredHostnames.has(hostname)
      ));
      if (namesRequiringRegistration.length === 0) return true;

      const registered = normalizeConfiguredHostname(
        await registeredPublicHostname(),
      );
      return registered !== undefined
        && namesRequiringRegistration.every((hostname) => hostname === registered);
    },
  };
}

function requestAuthorityHostname(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    return undefined;
  }
  return authorityHostname(value, true);
}

function requestOriginHostname(
  value: string | readonly string[],
): string | undefined {
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    return undefined;
  }

  try {
    const origin = new URL(value);
    if ((origin.protocol !== "http:" && origin.protocol !== "https:")
      || origin.username !== ""
      || origin.password !== ""
      || origin.pathname !== "/"
      || origin.search !== ""
      || origin.hash !== "") {
      return undefined;
    }
    return normalizeUrlHostname(origin.hostname);
  } catch {
    return undefined;
  }
}

function normalizeConfiguredHostname(value: string | undefined): string | undefined {
  if (value === undefined || value === "" || value !== value.trim()) return undefined;
  // Vite supports leading-dot subdomain patterns, but Safe Tunnel mutations
  // require an exact operator-selected DNS name.
  if (value.startsWith(".")) return undefined;

  if (isIP(value) === 6) return authorityHostname(`[${value}]`, false);
  return authorityHostname(value, false);
}

function authorityHostname(value: string, allowPort: boolean): string | undefined {
  if (/[\\/?#@]/u.test(value)) return undefined;

  try {
    const authority = new URL(`http://${value}`);
    if (authority.username !== ""
      || authority.password !== ""
      || authority.pathname !== "/"
      || authority.search !== ""
      || authority.hash !== ""
      || (!allowPort && authority.port !== "")) {
      return undefined;
    }
    return normalizeUrlHostname(authority.hostname);
  } catch {
    return undefined;
  }
}

function normalizeUrlHostname(value: string): string | undefined {
  const unbracketed = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  const withoutRootDot = unbracketed.endsWith(".")
    ? unbracketed.slice(0, -1)
    : unbracketed;
  if (withoutRootDot === "" || withoutRootDot.endsWith(".")) return undefined;
  return withoutRootDot.toLowerCase();
}

function isIntrinsicallyTrustedHostname(hostname: string): boolean {
  // Literal IP origins cannot retain a DNS name while rebinding elsewhere.
  return hostname === "localhost" || isIP(hostname) !== 0;
}
