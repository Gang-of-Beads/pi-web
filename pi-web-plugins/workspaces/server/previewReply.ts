import type { ServerPluginReply } from "@gang-of-beads/pi-web/server-plugin-api";
import { workspaceFilePreviewErrorResponsePolicy } from "./filePreviewResponsePolicy.js";

/**
 * Hardens a failed preview response. Preview URLs are navigated directly by
 * the browser, so an error body carrying attacker-influenced path text must
 * never be sniffable into active content - the identical contract the core
 * preview route applies. A failure is never cached: the route sets a cache
 * lifetime for the file it expects to send, and a file it then fails to send
 * must not leave that lifetime on the error.
 */
export function applyWorkspaceFilePreviewErrorResponsePolicy(reply: ServerPluginReply): ServerPluginReply {
  const policy = workspaceFilePreviewErrorResponsePolicy();
  return reply
    .header("Cache-Control", "no-store")
    .header("Content-Type", policy.contentType)
    .header("Content-Disposition", policy.contentDisposition)
    .header("Content-Security-Policy", policy.contentSecurityPolicy)
    .header("X-Content-Type-Options", policy.contentTypeOptions);
}
