/**
 * Azure Speech's socket framing.
 *
 * Messages are not bare JSON. Each is a text frame of `Header: value` lines, a
 * blank line, then the body - the same shape as an HTTP message - and the
 * header that matters is `Path`, which names what the body is. A decoder that
 * assumes JSON sees a parse error on every frame and reports a broken socket
 * for a service that is working perfectly.
 */
export interface AzureSpeechFrame {
  readonly path: string;
  /** Parsed body, or `undefined` for frames that carry none. */
  readonly body: Record<string, unknown> | undefined;
}

export function decodeAzureFrame(frame: string): AzureSpeechFrame | undefined {
  const separator = /\r?\n\r?\n/u.exec(frame);
  if (separator === null) return undefined;
  const headerBlock = frame.slice(0, separator.index);
  const body = frame.slice(separator.index + separator[0].length);

  let path: string | undefined;
  for (const line of headerBlock.split(/\r?\n/u)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon).trim().toLowerCase() === "path") path = line.slice(colon + 1).trim();
  }
  if (path === undefined || path === "") return undefined;

  return { path, body: parseBody(body) };
}

/**
 * @param requestId The id every frame of one turn shares. The service rejects
 * frames that omit it, and correlates audio with results by it.
 */
export function encodeAzureTextFrame(path: string, requestId: string, body: unknown): string {
  const headers = [
    `Path:${path}`,
    `X-RequestId:${requestId}`,
    `X-Timestamp:${new Date().toISOString()}`,
    "Content-Type:application/json",
  ].join("\r\n");
  return `${headers}\r\n\r\n${JSON.stringify(body)}`;
}

function parseBody(body: string): Record<string, unknown> | undefined {
  if (body.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) record[key] = value;
    return record;
  } catch {
    return undefined;
  }
}
