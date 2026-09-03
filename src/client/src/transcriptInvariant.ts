import type { ChatLine } from "./components/shared";
import { messageContentKey } from "./chatTranscript";

function userRowKey(line: ChatLine): string | undefined {
  const id = line.meta?.delivery?.clientMessageId ?? line.meta?.clientMessageId ?? line.meta?.echoClientMessageId;
  if (id !== undefined && id !== "") return `id:${id}`;
  const content = messageContentKey(line);
  return content === undefined ? undefined : `content:${content}`;
}

function mergeDuplicate(kept: ChatLine, duplicate: ChatLine): ChatLine {
  const delivery = kept.meta?.delivery ?? duplicate.meta?.delivery;
  const committed = kept.meta?.echo !== true || duplicate.meta?.echo !== true;
  const settledDelivery = delivery === undefined || !committed || delivery.state === "failed"
    ? delivery
    : { ...delivery, state: "delivered" as const };
  const base = kept.meta?.echo === true && duplicate.meta?.echo !== true ? duplicate : kept;
  const meta = { ...duplicate.meta, ...kept.meta, ...(settledDelivery === undefined ? {} : { delivery: settledDelivery }) };
  if (meta.echo === true && committed) delete meta.echo;
  return Object.keys(meta).length === 0 ? { ...base } : { ...base, meta };
}

export function oneRowPerIdentity(messages: readonly ChatLine[]): ChatLine[] {
  const seen = new Map<string, number>();
  const out: ChatLine[] = [];
  for (const line of messages) {
    if (line.role !== "user") {
      out.push(line);
      continue;
    }
    const key = userRowKey(line);
    if (key === undefined) {
      out.push(line);
      continue;
    }
    const at = seen.get(key);
    if (at === undefined) {
      seen.set(key, out.length);
      out.push(line);
      continue;
    }
    const kept = out[at];
    if (kept === undefined) {
      out.push(line);
      continue;
    }
    const sameSend = key.startsWith("id:") || kept.meta?.echo === true || line.meta?.echo === true;
    if (!sameSend) {
      out.push(line);
      continue;
    }
    out[at] = mergeDuplicate(kept, line);
  }
  return out.length === messages.length ? [...messages] : out;
}
