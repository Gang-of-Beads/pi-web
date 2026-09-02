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

/**
 * One chunk of microphone audio, in the only shape the service accepts.
 *
 * Audio is binary: a big-endian uint16 header length, the ASCII header block,
 * then the samples themselves. Sending it as a text frame with the samples
 * base64-encoded in JSON produces a socket that connects, answers `turn.start`
 * and then stays silent - no recognition, no error, no close. Probed against
 * the live endpoint with the same token and samples, only the framing differs:
 *
 *   text frame:    turn.start
 *   binary frame:  turn.start, speech.phrase, speech.endDetected, turn.end
 *
 * An empty chunk is how the client says the utterance is over.
 *
 * The samples are headerless PCM, and `Content-Type:audio/x-wav` names a format
 * that normally carries a RIFF header. This works because the service falls
 * back to its default input format - 16 kHz, 16-bit, mono - which is exactly
 * what the capture path resamples to, and because `speech.config` declares no
 * format of its own. So the wire format is agreed in two files that do not
 * reference each other: change AZURE_SAMPLE_RATE or the sample width and this
 * header stops describing what is being sent.
 */
export function encodeAzureAudioFrame(requestId: string, samples: Uint8Array): Uint8Array<ArrayBuffer> {
  const headers = [
    "Path:audio",
    `X-RequestId:${requestId}`,
    `X-Timestamp:${new Date().toISOString()}`,
    "Content-Type:audio/x-wav",
  ].join("\r\n");
  const headerBytes = new TextEncoder().encode(`${headers}\r\n\r\n`);
  const frame = new Uint8Array(new ArrayBuffer(2 + headerBytes.length + samples.length));
  frame[0] = (headerBytes.length >> 8) & 0xff;
  frame[1] = headerBytes.length & 0xff;
  frame.set(headerBytes, 2);
  frame.set(samples, 2 + headerBytes.length);
  return frame;
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
