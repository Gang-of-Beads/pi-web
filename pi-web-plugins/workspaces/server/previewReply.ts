import type { ServerPluginReply } from "@gang-of-beads/pi-web/server-plugin-api";
import { workspaceFilePreviewErrorResponsePolicy } from "./filePreviewResponsePolicy.js";

/**
 * Hardens a failed preview response. Preview URLs are navigated directly by
 * the browser, so an error body carrying attacker-influenced path text must
 * never be sniffable into active content - the identical contract the core
 * preview route applies.
 */
export function applyWorkspaceFilePreviewErrorResponsePolicy(reply: ServerPluginReply): ServerPluginReply {
  const policy = workspaceFilePreviewErrorResponsePolicy();
  return reply
    .header("Content-Type", policy.contentType)
    .header("Content-Disposition", policy.contentDisposition)
    .header("Content-Security-Policy", policy.contentSecurityPolicy)
    .header("X-Content-Type-Options", policy.contentTypeOptions);
}
