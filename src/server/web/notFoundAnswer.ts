/**
 * What the web answers for a path no route took.
 *
 * The client is a single-page app, so an application path it routes itself gets the document.
 * Two kinds of path must not: a hashed asset from a previous build (a cached index.html names
 * files that no longer exist, and answering those with the document handed HTML to a <script>
 * tag, which threw on the first `<` and left a blank page that an incognito window did not
 * show), and an API path (answering an unknown /api path with the document said 200 for a route
 * that does not exist, so a client read HTML where it expected an answer or a refusal).
 */
export type NotFoundAnswer = "document" | "missing-asset" | "missing-api";

const ASSET_PATH = /\.(?:js|mjs|css|map|json|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf)$/iu;

export function notFoundAnswer(url: string): NotFoundAnswer {
  const path = url.split("?")[0] ?? "";
  if (path === "/api" || path.startsWith("/api/")) return "missing-api";
  if (ASSET_PATH.test(path)) return "missing-asset";
  return "document";
}
