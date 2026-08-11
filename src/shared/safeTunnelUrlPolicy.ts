/**
 * Plaintext Control API endpoints are a development-only exception. Restrict
 * them to URL-parser-normalized literal loopback addresses so DNS or hosts-file
 * changes cannot redirect bearer credentials to another machine.
 */
export function isSafeTunnelLoopbackHostname(hostname: string): boolean {
  if (hostname === "[::1]") return true;
  const ipv4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(hostname);
  return ipv4?.slice(1).every((octet) => Number(octet) <= 255) ?? false;
}

export function isSafeTunnelControlApiTransportAllowed(url: URL): boolean {
  return url.protocol === "https:"
    || (url.protocol === "http:" && isSafeTunnelLoopbackHostname(url.hostname));
}
